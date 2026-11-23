// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Code } from "@the-protobuf-project/errors";

/** Where an execution is in its life. */
export type ExecutionStatus = "running" | "paused" | "completed" | "error" | "rejected" | "rolled_back";

/** A terminal status: the execution will not run again. */
export type TerminalStatus = Exclude<ExecutionStatus, "running" | "paused">;

/** An error as it is stored and returned to sandboxed code. */
export interface SerializedError {
  code: Code;
  message: string;
  reason?: string;
  details?: unknown[];
}

/** One recorded connector call or codemode.step(), by sequence number. */
export interface LogEntry {
  seq: number;
  kind: "call" | "step";
  /** "library.createBook" for calls, the step name for steps. */
  path: string;
  args?: unknown;
  /** The call's second argument, when it had one. */
  options?: unknown;
  result?: unknown;
  error?: SerializedError;
  /** Set once rollback has undone the call. */
  reverted?: boolean;
}

/** A call waiting for a person's approval. */
export interface PendingAction {
  executionId: string;
  seq: number;
  connector: string;
  method: string;
  path: string;
  args: unknown;
  /** The call's second argument, e.g. a stream's { limit, timeoutMs }. */
  options?: unknown;
  message?: string;
}

/** A model's code and everything that happened when it ran. */
export interface Execution {
  id: string;
  code: string;
  status: ExecutionStatus;
  createdAt: number;
  updatedAt: number;
  passes: number;
  log: LogEntry[];
  /** Sequence numbers a person approved. */
  approved: number[];
  pending: PendingAction[];
  result?: unknown;
  error?: string;
  logs: string[];
}

/** Reusable code, saved from an execution or shipped in the proto. */
export interface Snippet {
  name: string;
  description?: string;
  /** An async function of one input. */
  code: string;
  inputSchema?: unknown;
  inputType?: string;
  source: "proto" | "saved";
  createdAt: number;
}

/** The codemode tool's input. */
export interface CodeInput {
  code: string;
}

/** The codemode tool's output. */
export type CodeOutput =
  | { status: "completed"; executionId: string; result: unknown; logs?: string[] }
  | { status: "paused"; executionId: string; pending: PendingAction[] }
  | { status: "error"; executionId: string; error: string; logs?: string[] };

/** Lifecycle hooks. They must be idempotent and must not throw. */
export interface Hooks {
  /** After every pass, paused ones included. */
  onPassEnd?(executionId: string, status: Exclude<ExecutionStatus, "running">): void | Promise<void>;
  /** Once, when an execution reaches a terminal status. */
  disposeExecution?(executionId: string, status: TerminalStatus): void | Promise<void>;
}

/** What a rollback did. */
export interface RollbackResult {
  executionId: string;
  status: ExecutionStatus;
  reverted: string[];
  skipped: string[];
  failures: { path: string; error: string }[];
}
