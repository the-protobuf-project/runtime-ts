// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeState } from "./state.ts";
import type { TerminalStatus } from "./types.ts";

/** Deletes the oldest finished executions beyond keep. Returns how many. */
export async function pruneExecutions(state: RuntimeState, keep: number): Promise<number> {
  const all = await state.store.listExecutions();
  const finished = all.filter((e) => e.status !== "running" && e.status !== "paused");
  let removed = 0;
  for (const e of finished.slice(keep)) {
    if (await state.store.deleteExecution(e.id)) removed++;
  }
  return removed;
}

/**
 * Ends executions that waited too long: paused ones become rejected, and
 * running ones, left behind by a crash, become errors.
 */
export async function expirePaused(state: RuntimeState, maxAgeMs: number): Promise<string[]> {
  const cutoff = Date.now() - maxAgeMs;
  const ended: string[] = [];
  for (const e of await state.store.listExecutions()) {
    if (e.updatedAt > cutoff || (e.status !== "paused" && e.status !== "running")) continue;
    const status: TerminalStatus = e.status === "paused" ? "rejected" : "error";
    e.status = status;
    e.error = status === "rejected" ? "approval expired" : "execution expired while running";
    e.pending = [];
    e.updatedAt = Date.now();
    await state.store.putExecution(e);
    try {
      await state.hooks.disposeExecution?.(e.id, status);
    } catch {
      // Hooks must not throw.
    }
    ended.push(e.id);
  }
  return ended;
}
