// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { getQuickJS, type QuickJSDeferredPromise, type QuickJSWASMModule } from "quickjs-emscripten";
import { deadline, type ExecuteRequest, type ExecuteResult, type Executor } from "../executor/types.ts";

/** Options for the QuickJS executor. */
export interface QuickJSExecutorOptions {
  /** A loaded QuickJS module; defaults to the release build. */
  module?: QuickJSWASMModule | Promise<QuickJSWASMModule>;
  /** Native stack limit for each pass, in bytes. Defaults to 1 MiB. */
  maxStackBytes?: number;
}

/**
 * Runs each pass in a fresh QuickJS interpreter compiled to WebAssembly. The
 * interpreter has no network, filesystem, timers or host objects: only the
 * bridge. An interrupt handler stops runaway loops at the deadline, and a
 * memory limit caps the heap. Works on Node, Bun, Deno and in browsers.
 */
export class QuickJSExecutor implements Executor {
  private readonly module: Promise<QuickJSWASMModule>;
  private readonly maxStackBytes: number;

  constructor(options: QuickJSExecutorOptions = {}) {
    this.module = Promise.resolve(options.module ?? getQuickJS());
    this.maxStackBytes = options.maxStackBytes ?? 1024 * 1024;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const quickjs = await this.module;
    const runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(request.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(this.maxStackBytes);
    const stopAt = Date.now() + request.timeoutMs;
    runtime.setInterruptHandler(() => request.signal.aborted || Date.now() > stopAt);

    const vm = runtime.newContext();
    const pending = new Set<QuickJSDeferredPromise>();
    let alive = true;

    const host = vm.newFunction("__host", (opHandle, payloadHandle) => {
      const deferred = vm.newPromise();
      pending.add(deferred);
      request.host(vm.getString(opHandle), vm.getString(payloadHandle)).then(
        (out) => {
          if (!alive || !deferred.alive) return;
          const s = vm.newString(out);
          deferred.resolve(s);
          s.dispose();
          pending.delete(deferred);
          runtime.executePendingJobs();
        },
        (err: unknown) => {
          if (!alive || !deferred.alive) return;
          const s = vm.newString(JSON.stringify({ error: { code: "INTERNAL", message: String(err) } }));
          deferred.resolve(s);
          s.dispose();
          pending.delete(deferred);
          runtime.executePendingJobs();
        },
      );
      return deferred.handle;
    });
    vm.setProp(vm.global, "__host", host);
    host.dispose();

    const timer = deadline(request.timeoutMs, request.signal);
    try {
      const evaluated = vm.evalCode(request.script, "sandbox.js");
      if (evaluated.error) {
        const err = vm.dump(evaluated.error) as { message?: string } | string;
        evaluated.error.dispose();
        return failure(err, request, stopAt);
      }
      const settled = vm.resolvePromise(evaluated.value);
      evaluated.value.dispose();
      runtime.executePendingJobs();
      const outcome = await Promise.race([settled, timer.promise]);
      if (outcome === "timeout" || outcome === "aborted") {
        return outcome === "aborted"
          ? { ok: false, error: "aborted", aborted: true }
          : { ok: false, error: `timed out after ${request.timeoutMs} ms` };
      }
      if (outcome.error) {
        const err = vm.dump(outcome.error) as { message?: string } | string;
        outcome.error.dispose();
        return failure(err, request, stopAt);
      }
      const json = vm.getString(outcome.value);
      outcome.value.dispose();
      // Sandboxed code can catch the interrupt; past the deadline, it timed out.
      if (Date.now() > stopAt) return { ok: false, error: `timed out after ${request.timeoutMs} ms` };
      return { ok: true, json };
    } finally {
      timer.cancel();
      alive = false;
      for (const d of pending) if (d.alive) d.dispose();
      vm.dispose();
      runtime.dispose();
    }
  }
}

function failure(err: { message?: string } | string, request: ExecuteRequest, stopAt: number): ExecuteResult {
  if (request.signal.aborted) return { ok: false, error: "aborted", aborted: true };
  if (Date.now() > stopAt) return { ok: false, error: `timed out after ${request.timeoutMs} ms` };
  const message = typeof err === "string" ? err : (err.message ?? JSON.stringify(err));
  return { ok: false, error: message };
}
