// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { CodemodeRuntime } from "../runtime/runtime.ts";
import type { CodeOutput, Execution } from "../runtime/types.ts";

/** A call a person approved, as codemode_status reports it. */
export interface ApprovedCall {
  seq: number;
  path: string;
  args: unknown;
}

/**
 * An execution as the code tool would have returned it, plus the calls a
 * person approved so far, so the model can report them even when approval
 * happened elsewhere, e.g. on an approval page.
 */
export async function status(
  runtime: CodemodeRuntime,
  id: string,
): Promise<CodeOutput & { approved?: ApprovedCall[] }> {
  const exec = await runtime.getExecution(id);
  if (!exec) return { status: "error", executionId: id, error: `no execution ${id}` };
  const approved = approvedCalls(exec);
  switch (exec.status) {
    case "completed":
      return { status: "completed", executionId: id, result: exec.result, approved };
    case "paused":
      return { status: "paused", executionId: id, pending: exec.pending, approved };
    default:
      return { status: "error", executionId: id, error: exec.error ?? exec.status, approved };
  }
}

/** Approved calls that ran, in order. One approved but not yet run is still pending. */
function approvedCalls(exec: Execution): ApprovedCall[] {
  return exec.log
    .filter((e) => e.kind === "call" && exec.approved.includes(e.seq))
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ seq: e.seq, path: e.path, args: e.args }));
}
