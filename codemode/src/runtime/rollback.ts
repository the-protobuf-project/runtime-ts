// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import type { RuntimeState } from "./state.ts";
import type { RollbackResult } from "./types.ts";

/**
 * Runs each applied call's revert, newest first. Calls without a revert, or
 * whose connector is gone, are skipped; a failing revert is reported and the
 * rest still run. The execution becomes rolled_back if anything was undone.
 */
export async function rollback(state: RuntimeState, executionId: string): Promise<RollbackResult> {
  const exec = await state.store.getExecution(executionId);
  if (!exec) throw new StatusError("NOT_FOUND", `no execution ${executionId}`);
  if (exec.status === "running") throw new StatusError("FAILED_PRECONDITION", `execution ${executionId} is still running`);

  const out: RollbackResult = { executionId, status: exec.status, reverted: [], skipped: [], failures: [] };
  const applied = exec.log.filter((e) => e.kind === "call" && !e.error && !e.reverted).sort((a, b) => b.seq - a.seq);
  for (const entry of applied) {
    const method = state.methods.get(entry.path)?.method;
    if (!method?.revert) {
      if (!method?.requiresApproval && state.catalog.methods.find((m) => m.path === entry.path)?.readOnly) continue;
      out.skipped.push(entry.path);
      continue;
    }
    try {
      await method.revert(entry.args, entry.result, { executionId });
      entry.reverted = true;
      out.reverted.push(entry.path);
    } catch (e) {
      out.failures.push({ path: entry.path, error: (e as Error).message });
    }
  }
  if (out.reverted.length > 0) {
    if (exec.status !== "paused") exec.status = "rolled_back";
    else {
      exec.status = "rolled_back";
      exec.pending = [];
    }
  }
  exec.updatedAt = Date.now();
  await state.store.putExecution(exec);
  if (exec.status === "rolled_back") {
    try {
      await state.hooks.disposeExecution?.(exec.id, "rolled_back");
    } catch {
      // Hooks must not throw.
    }
  }
  out.status = exec.status;
  return out;
}
