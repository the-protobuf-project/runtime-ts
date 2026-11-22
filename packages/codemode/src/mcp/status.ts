// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { CodemodeRuntime } from "../runtime/runtime.ts";
import type { CodeOutput } from "../runtime/types.ts";

/** An execution as the code tool would have returned it. */
export async function status(runtime: CodemodeRuntime, id: string): Promise<CodeOutput> {
  const exec = await runtime.getExecution(id);
  if (!exec) return { status: "error", executionId: id, error: `no execution ${id}` };
  switch (exec.status) {
    case "completed":
      return { status: "completed", executionId: id, result: exec.result };
    case "paused":
      return { status: "paused", executionId: id, pending: exec.pending };
    default:
      return { status: "error", executionId: id, error: exec.error ?? exec.status };
  }
}
