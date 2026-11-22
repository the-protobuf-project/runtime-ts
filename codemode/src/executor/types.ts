// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/**
 * The one way out of the sandbox. Sandboxed code calls it with an operation
 * name and a JSON payload and gets a JSON envelope back:
 * `{"value": ...}` or `{"error": {...}}`.
 */
export type HostCall = (op: string, payload: string) => Promise<string>;

/** One sandbox pass. */
export interface ExecuteRequest {
  /** Self-contained script from buildScript(); evaluates to a promise of the result JSON. */
  script: string;
  host: HostCall;
  timeoutMs: number;
  memoryMb: number;
  /** Aborted when the pass must stop now, e.g. to pause for approval. */
  signal: AbortSignal;
}

/** What the sandbox returned: the script's result envelope, or why it failed. */
export type ExecuteResult =
  | { ok: true; json: string }
  | { ok: false; error: string; aborted?: boolean };

/**
 * Runs untrusted code in isolation. The code gets no network, filesystem,
 * environment or credentials; it reaches the outside only through host().
 */
export interface Executor {
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
}

/** Resolves after ms, or rejects at once when signal aborts. */
export function deadline(ms: number, signal: AbortSignal): { promise: Promise<"timeout" | "aborted">; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<"timeout" | "aborted">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
    onAbort = () => resolve("aborted");
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    cancel() {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}
