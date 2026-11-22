// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Execution, Snippet } from "../runtime/types.ts";
import type { Store } from "./types.ts";

/** Keeps state in memory. For tests and single-process hosts that may lose it. */
export class MemoryStore implements Store {
  private readonly executions = new Map<string, Execution>();
  private readonly snippets = new Map<string, Snippet>();

  async getExecution(id: string): Promise<Execution | undefined> {
    const e = this.executions.get(id);
    return e && structuredClone(e);
  }

  async putExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, structuredClone(execution));
  }

  async deleteExecution(id: string): Promise<boolean> {
    return this.executions.delete(id);
  }

  async listExecutions(limit = Number.POSITIVE_INFINITY): Promise<Execution[]> {
    return [...this.executions.values()]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }

  async getSnippet(name: string): Promise<Snippet | undefined> {
    const s = this.snippets.get(name);
    return s && structuredClone(s);
  }

  async putSnippet(snippet: Snippet): Promise<void> {
    this.snippets.set(snippet.name, structuredClone(snippet));
  }

  async deleteSnippet(name: string): Promise<boolean> {
    return this.snippets.delete(name);
  }

  async listSnippets(): Promise<Snippet[]> {
    return [...this.snippets.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => structuredClone(s));
  }
}
