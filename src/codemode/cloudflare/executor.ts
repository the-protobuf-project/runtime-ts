// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { RpcTarget } from "cloudflare:workers";
import { deadline, type ExecuteRequest, type ExecuteResult, type Executor, type HostCall } from "../executor/types.ts";

/** What a Worker Loader returns: a stub with entrypoints. */
interface LoadedWorker {
  getEntrypoint(name?: string): { run(): Promise<string> };
}

/** The code a Worker Loader runs. */
interface WorkerCode {
  compatibilityDate: string;
  mainModule: string;
  modules: Record<string, string>;
  env: Record<string, unknown>;
  globalOutbound: unknown;
}

/** A worker_loaders binding: either API generation fits. */
export interface WorkerLoader {
  load?(code: WorkerCode): LoadedWorker;
  get?(id: string, code: () => WorkerCode | Promise<WorkerCode>): LoadedWorker;
}

/** Options for the Worker Loader executor. */
export interface WorkerLoaderExecutorOptions {
  /** The worker_loaders binding, e.g. env.LOADER. */
  loader: WorkerLoader;
  compatibilityDate?: string;
  /** null blocks outbound fetch() and connect(); a Fetcher routes them. Defaults to null. */
  globalOutbound?: unknown;
}

/** Carries host calls from the sandbox Worker back over Workers RPC. */
class HostBridge extends RpcTarget {
  private readonly host: HostCall;
  constructor(host: HostCall) {
    super();
    this.host = host;
  }
  call(op: string, payload: string): Promise<string> {
    return this.host(op, payload);
  }
}

/**
 * Runs each pass in a fresh Worker isolate created by a Worker Loader, with
 * outbound network blocked. The sandbox reaches the host only through an RPC
 * stub; credentials stay in the parent Worker.
 */
export class WorkerLoaderExecutor implements Executor {
  private readonly options: WorkerLoaderExecutorOptions;

  constructor(options: WorkerLoaderExecutorOptions) {
    this.options = options;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const main = `import { WorkerEntrypoint } from "cloudflare:workers";
export default class Sandbox extends WorkerEntrypoint {
  async run() {
    const env = this.env;
    globalThis.__host = (op, payload) => env.HOST.call(op, payload);
${request.script};
    return await globalThis.__result;
  }
}`;
    const code: WorkerCode = {
      compatibilityDate: this.options.compatibilityDate ?? "2026-11-01",
      mainModule: "sandbox.js",
      modules: { "sandbox.js": main },
      env: { HOST: new HostBridge(request.host) },
      globalOutbound: this.options.globalOutbound ?? null,
    };
    const { loader } = this.options;
    const worker = loader.load ? loader.load(code) : loader.get?.(crypto.randomUUID(), () => code);
    if (!worker) return { ok: false, error: "the worker loader binding has neither load() nor get()" };

    const timer = deadline(request.timeoutMs, request.signal);
    try {
      const outcome = await Promise.race([worker.getEntrypoint().run(), timer.promise]);
      if (outcome === "aborted") return { ok: false, error: "aborted", aborted: true };
      if (outcome === "timeout") return { ok: false, error: `timed out after ${request.timeoutMs} ms` };
      return { ok: true, json: outcome };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      timer.cancel();
    }
  }
}
