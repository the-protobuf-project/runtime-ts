// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Execution, Snippet } from "../runtime/types.ts";

/**
 * Durable state: executions, with their call logs and pending approvals, and
 * snippets. The runtime holds nothing in memory between calls, so any store
 * that survives a restart makes executions survive it too.
 */
export interface Store {
  getExecution(id: string): Promise<Execution | undefined>;
  putExecution(execution: Execution): Promise<void>;
  deleteExecution(id: string): Promise<boolean>;
  /** Newest first. */
  listExecutions(limit?: number): Promise<Execution[]>;

  getSnippet(name: string): Promise<Snippet | undefined>;
  putSnippet(snippet: Snippet): Promise<void>;
  deleteSnippet(name: string): Promise<boolean>;
  /** Ordered by name. */
  listSnippets(): Promise<Snippet[]>;
}
