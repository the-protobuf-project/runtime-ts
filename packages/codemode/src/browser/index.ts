// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { deadline, type ExecuteRequest, type ExecuteResult, type Executor } from "../executor/types.ts";

/** Options for the iframe executor. */
export interface IframeExecutorOptions {
  /** Content-Security-Policy for the sandbox document. Defaults to no network. */
  csp?: string;
}

const defaultCsp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';";

/**
 * Runs each pass in a hidden iframe with sandbox="allow-scripts" and a CSP
 * that blocks network access. Calls cross by postMessage, scoped by a nonce.
 * A browser cannot interrupt a synchronous loop in the frame; the deadline
 * removes the frame, which ends it.
 */
export class IframeExecutor implements Executor {
  private readonly csp: string;

  constructor(options: IframeExecutorOptions = {}) {
    this.csp = options.csp ?? defaultCsp;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const nonce = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${this.csp}"><script>
const __nonce = ${JSON.stringify(nonce)};
const __waiting = new Map();
let __next = 0;
globalThis.__host = (op, payload) => new Promise((resolve) => {
  const id = ++__next;
  __waiting.set(id, resolve);
  parent.postMessage({ nonce: __nonce, t: "call", id, op, payload }, "*");
});
addEventListener("message", (e) => {
  if (e.data?.nonce === __nonce && e.data.t === "reply") { __waiting.get(e.data.id)?.(e.data.result); __waiting.delete(e.data.id); }
});
${request.script.replaceAll("</script", "<\\/script")};
globalThis.__result.then((json) => parent.postMessage({ nonce: __nonce, t: "done", json }, "*"));
</script>`;

    const timer = deadline(request.timeoutMs, request.signal);
    let listener: ((e: MessageEvent) => void) | undefined;
    const done = new Promise<ExecuteResult>((resolve) => {
      listener = (e: MessageEvent) => {
        const d = e.data as { nonce?: string; t?: string; id?: number; op?: string; payload?: string; json?: string };
        if (e.source !== frame.contentWindow || d?.nonce !== nonce) return;
        if (d.t === "done") resolve({ ok: true, json: d.json ?? "" });
        if (d.t === "call") {
          void request.host(d.op ?? "", d.payload ?? "").then((result) => {
            frame.contentWindow?.postMessage({ nonce, t: "reply", id: d.id, result }, "*");
          });
        }
      };
      addEventListener("message", listener);
    });
    document.body.appendChild(frame);
    try {
      const outcome = await Promise.race([done, timer.promise]);
      if (outcome === "aborted") return { ok: false, error: "aborted", aborted: true };
      if (outcome === "timeout") return { ok: false, error: `timed out after ${request.timeoutMs} ms` };
      return outcome;
    } finally {
      timer.cancel();
      if (listener) removeEventListener("message", listener);
      frame.remove();
    }
  }
}
