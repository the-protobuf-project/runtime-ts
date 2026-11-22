// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { describe, search } from "../catalog/search.ts";
import { CodemodeError } from "../../errors/index.ts";
import { buildScript } from "../executor/prelude.ts";
import type { HostCall } from "../executor/types.ts";
import { outboundFetch, type OutboundRequest } from "./outbound.ts";
import type { RuntimeState } from "./state.ts";
import type { Execution, LogEntry } from "./types.ts";
import { checkSize, deserializeError, serializeError, stableJson } from "./values.ts";

/** Thrown inside the bridge to end a pass: to pause, or because replay diverged. */
class Stop {
  readonly fatal: string | undefined;
  constructor(fatal?: string) {
    this.fatal = fatal;
  }
}

const never = (): Promise<string> => new Promise<string>(() => {});
const maxLogLines = 500;

function record(exec: Execution, entry: LogEntry): void {
  const i = exec.log.findIndex((e) => e.seq === entry.seq);
  if (i >= 0) exec.log[i] = entry;
  else exec.log.push(entry);
}

/**
 * Runs one pass of an execution's code from the top. Calls already in the
 * log return their recorded results; the first call that needs approval
 * pauses the pass. Updates exec in place; the caller persists it.
 */
export async function runPass(state: RuntimeState, exec: Execution): Promise<void> {
  exec.passes += 1;
  exec.status = "running";
  exec.pending = [];
  delete exec.error;
  const controller = new AbortController();
  const snippets = await state.snippetList();
  let seq = 0;
  let fatal: string | undefined;
  const max = state.maxValueBytes;

  const call = async (path: string, args: unknown): Promise<unknown> => {
    const s = ++seq;
    const target = state.methods.get(path);
    if (!target) throw new CodemodeError("NOT_FOUND", `${path} is not a method; use codemode.search() to find one`);
    checkSize(`${path} arguments`, args, max);
    const entry = exec.log.find((e) => e.seq === s);
    if (entry) {
      if (entry.kind !== "call" || entry.path !== path || stableJson(entry.args) !== stableJson(args)) {
        throw new Stop(`replay diverged at call ${s}: expected ${entry.path}, got ${path} with different arguments. ` +
          "Call methods one at a time, in the same order, and record time or randomness with codemode.step().");
      }
      if (entry.error) throw deserializeError(entry.error);
      if (target.method.replay === "log") return entry.result;
    }
    if (target.method.requiresApproval && !exec.approved.includes(s)) {
      exec.pending.push({
        executionId: exec.id, seq: s, connector: target.namespace, method: target.method.name, path, args,
        ...(target.method.approvalMessage ? { message: target.method.approvalMessage } : {}),
      });
      throw new Stop();
    }
    try {
      const result = await target.method.execute(args, { executionId: exec.id, signal: controller.signal });
      checkSize(`${path} result`, result, max);
      record(exec, { seq: s, kind: "call", path, args, result });
      return result;
    } catch (e) {
      record(exec, { seq: s, kind: "call", path, args, error: serializeError(e) });
      throw e;
    }
  };

  const step = (name: string): { hit: boolean; value?: unknown; seq: number } => {
    const s = ++seq;
    const entry = exec.log.find((e) => e.seq === s);
    if (!entry) return { hit: false, seq: s };
    if (entry.kind !== "step" || entry.path !== name) throw new Stop(`replay diverged at step ${s}: expected ${entry.path}, got ${name}`);
    return { hit: true, value: entry.result, seq: s };
  };

  const host: HostCall = async (op, payload) => {
    if (controller.signal.aborted) return never();
    try {
      const p = JSON.parse(payload) as Record<string, unknown>;
      let value: unknown = null;
      if (op === "call") value = await call(String(p["path"]), p["args"]);
      else if (op === "step") value = step(String(p["name"]));
      else if (op === "step.put") {
        checkSize("step value", p["value"], max);
        record(exec, { seq: Number(p["seq"]), kind: "step", path: String(p["name"]), result: p["value"] });
      } else if (op === "fetch" && state.config.executor?.outbound === "allowlist") {
        value = await outboundFetch(p as unknown as OutboundRequest, state.config.executor.allow ?? [], max, controller.signal);
      } else if (op === "search") value = search(state.catalog, snippets, String(p["query"]));
      else if (op === "describe") value = describe(state.catalog, snippets, String(p["target"]));
      else if (op === "log") {
        if (exec.logs.length < maxLogLines) exec.logs.push(String(p["text"]));
      } else throw new CodemodeError("UNIMPLEMENTED", `unknown host operation ${op}`);
      return JSON.stringify({ value: value === undefined ? null : value });
    } catch (e) {
      if (e instanceof Stop) {
        fatal ??= e.fatal;
        controller.abort();
        return never();
      }
      return JSON.stringify({ error: serializeError(e) });
    }
  };

  const script = buildScript({
    namespaces: state.namespaceMethods(),
    snippets: Object.fromEntries(snippets.map((s) => [s.name, s.code])),
    outbound: state.config.executor?.outbound === "allowlist",
  }, exec.code);
  const res = await state.executor.execute({ script, host, timeoutMs: state.timeoutMs, memoryMb: state.memoryMb, signal: controller.signal });
  exec.updatedAt = Date.now();
  if (fatal) return finish(exec, "error", fatal);
  if (exec.pending.length > 0) return void (exec.status = "paused");
  if (!res.ok) return finish(exec, "error", res.error);
  const out = JSON.parse(res.json) as { ok: boolean; value?: unknown; error?: { code?: string; name?: string; message?: string } };
  if (!out.ok) {
    const e = out.error ?? {};
    return finish(exec, "error", `${e.code ?? e.name ?? "Error"}: ${e.message ?? ""}`);
  }
  exec.status = "completed";
  exec.result = out.value;
}

function finish(exec: Execution, status: "error", error: string): void {
  exec.status = status;
  exec.error = error;
}
