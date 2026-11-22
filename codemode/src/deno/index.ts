// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { deadline, type ExecuteRequest, type ExecuteResult, type Executor } from "../executor/types.ts";

/** Options for the Deno executor. */
export interface DenoExecutorOptions {
  /** The deno binary. Defaults to "deno" on PATH. */
  command?: string;
}

// Runs inside Deno. Messages are JSON lines: the sandbox writes calls to
// stdout, the host answers on stdin.
const bootstrap = `
const __encoder = new TextEncoder();
const __send = (m) => Deno.stdout.writeSync(__encoder.encode(JSON.stringify(m) + "\\n"));
const __waiting = new Map();
let __next = 0;
globalThis.__host = (op, payload) => new Promise((resolve) => {
  const id = ++__next;
  __waiting.set(id, resolve);
  __send({ t: "call", id, op, payload });
});
(async () => {
  let buf = "";
  for await (const chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let at;
    while ((at = buf.indexOf("\\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      __waiting.get(msg.id)?.(msg.result);
      __waiting.delete(msg.id);
    }
  }
})();
`;

// Deny flags win over any grant. They matter when the host itself runs on
// Deno, whose node:child_process passes its own permissions to a spawned deno.
const denied = ["--deny-read", "--deny-write", "--deny-net", "--deny-env", "--deny-run", "--deny-ffi", "--deny-sys"];

/**
 * Runs each pass in a separate Deno process with no permissions: no network,
 * filesystem, environment or subprocesses. The process is killed at the
 * deadline or when the pass is aborted. Needs the deno binary installed;
 * the host itself can be Node, Bun or Deno.
 */
export class DenoExecutor implements Executor {
  private readonly command: string;

  constructor(options: DenoExecutorOptions = {}) {
    this.command = options.command ?? "deno";
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const program = `${bootstrap}\n${request.script};\nconst __out = await globalThis.__result;\n__send({ t: "done", result: __out });\nDeno.exit(0);\n`;
    const url = `data:text/javascript;base64,${Buffer.from(program).toString("base64")}`;
    const child = spawn(
      this.command,
      ["run", ...denied, "--no-prompt", "--quiet", "--no-config", "--no-lock", `--v8-flags=--max-old-space-size=${request.memoryMb}`, url],
      { stdio: ["pipe", "pipe", "pipe"], env: { NO_COLOR: "1", PATH: process.env["PATH"] ?? "" } },
    );
    const timer = deadline(request.timeoutMs, request.signal);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()).length > 8192 && (stderr = stderr.slice(-8192)));

    const done = new Promise<ExecuteResult>((resolve) => {
      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        let at: number;
        while ((at = buf.indexOf("\n")) >= 0) {
          const msg = JSON.parse(buf.slice(0, at)) as { t: string; id?: number; op?: string; payload?: string; result?: string };
          buf = buf.slice(at + 1);
          if (msg.t === "done") resolve({ ok: true, json: msg.result ?? "" });
          else if (msg.t === "call") {
            void request.host(msg.op ?? "", msg.payload ?? "").then((result) => {
              if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            });
          }
        }
      });
      child.on("error", (e) => resolve({ ok: false, error: `cannot start deno: ${e.message}` }));
      child.on("exit", (code) => resolve({ ok: false, error: stderr.trim() || `deno exited with code ${code}` }));
    });

    try {
      const outcome = await Promise.race([done, timer.promise]);
      if (outcome === "aborted") return { ok: false, error: "aborted", aborted: true };
      if (outcome === "timeout") return { ok: false, error: `timed out after ${request.timeoutMs} ms` };
      return outcome;
    } finally {
      timer.cancel();
      child.kill("SIGKILL");
    }
  }
}
