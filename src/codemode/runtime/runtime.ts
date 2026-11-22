// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { describe, search, type Description, type SearchResults } from "../catalog/search.ts";
import { CodemodeError } from "../../errors/index.ts";
import { normalizeCode } from "../executor/normalize.ts";
import { expirePaused, pruneExecutions } from "./housekeeping.ts";
import { runPass } from "./pass.ts";
import { rollback } from "./rollback.ts";
import { deleteSnippet, saveSnippet, type SaveSnippetOptions } from "./snippets.ts";
import { RuntimeState, type CodemodeOptions } from "./state.ts";
import { toolDescription, type CodemodeTool } from "./tool.ts";
import { truncateResult } from "./truncate.ts";
import type { CodeInput, CodeOutput, Execution, PendingAction, RollbackResult, Snippet } from "./types.ts";

/**
 * The durable Code Mode runtime: runs model code in the sandbox, pauses for
 * approval, replays on resume, rolls back, and keeps snippets. Every method
 * reads and writes the store, so the runtime itself can be recreated freely.
 */
export class CodemodeRuntime {
  private readonly state: RuntimeState;

  constructor(options: CodemodeOptions) {
    this.state = new RuntimeState(options);
  }

  /** The tool to hand a model: one `code` input, a status union out. */
  tool(): CodemodeTool {
    return {
      name: "codemode",
      description: toolDescription(this.state.catalog, this.state.config.discovery ?? "progressive"),
      inputSchema: {
        type: "object",
        properties: { code: { type: "string", description: "An async arrow function, e.g. async () => { ... }" } },
        required: ["code"],
        additionalProperties: false,
      },
      execute: (input) => this.execute(input),
    };
  }

  /** Runs new code. */
  async execute(input: CodeInput): Promise<CodeOutput> {
    const now = Date.now();
    const exec: Execution = {
      id: crypto.randomUUID(), code: "", status: "running", createdAt: now, updatedAt: now,
      passes: 0, log: [], approved: [], pending: [], logs: [],
    };
    try {
      exec.code = normalizeCode(input.code);
    } catch (e) {
      exec.status = "error";
      exec.error = (e as Error).message;
      return this.save(exec);
    }
    await this.state.store.putExecution(exec);
    const out = await this.pass(exec);
    await pruneExecutions(this.state, this.state.maxExecutions);
    return out;
  }

  /** Approves the pending call and resumes. */
  async approve({ executionId }: { executionId: string }): Promise<CodeOutput> {
    const exec = await this.load(executionId);
    if (exec.status !== "paused") throw new CodemodeError("FAILED_PRECONDITION", `execution ${executionId} is ${exec.status}, not paused`);
    exec.approved.push(...exec.pending.map((p) => p.seq));
    return this.pass(exec);
  }

  /** Rejects a pending call, ending the execution. Earlier calls stay applied. */
  async reject({ executionId, seq }: { executionId: string; seq: number }): Promise<boolean> {
    const exec = await this.load(executionId);
    if (exec.status !== "paused" || !exec.pending.some((p) => p.seq === seq)) return false;
    exec.status = "rejected";
    exec.error = `call ${seq} was rejected`;
    exec.pending = [];
    await this.save(exec);
    return true;
  }

  /** Undoes an execution's applied calls, newest first. */
  rollback({ executionId }: { executionId: string }): Promise<RollbackResult> {
    return rollback(this.state, executionId);
  }

  /** Calls waiting for approval, for one execution or all. */
  async pending(executionId?: string): Promise<PendingAction[]> {
    if (executionId) return (await this.load(executionId)).pending;
    const all = await this.state.store.listExecutions();
    return all.filter((e) => e.status === "paused").flatMap((e) => e.pending);
  }

  executions(limit = 20): Promise<Execution[]> {
    return this.state.store.listExecutions(limit);
  }

  getExecution(executionId: string): Promise<Execution | undefined> {
    return this.state.store.getExecution(executionId);
  }

  deleteExecution(executionId: string): Promise<boolean> {
    return this.state.store.deleteExecution(executionId);
  }

  /** Keeps the newest `keep` finished executions; running and paused ones stay. */
  pruneExecutions(keep: number = this.state.maxExecutions): Promise<number> {
    return pruneExecutions(this.state, keep);
  }

  /** Rejects paused executions, and fails running ones, older than maxAgeMs. */
  expirePaused(options: { maxAgeMs?: number } = {}): Promise<string[]> {
    return expirePaused(this.state, options.maxAgeMs ?? this.state.pausedTtlMs);
  }

  async search(query: string): Promise<SearchResults> {
    return search(this.state.catalog, await this.state.snippetList(), query);
  }

  async describe(target: string): Promise<Description> {
    return describe(this.state.catalog, await this.state.snippetList(), target);
  }

  /** Saves a completed execution's code as a snippet the model can run. */
  saveSnippet(name: string, options: SaveSnippetOptions): Promise<Snippet> {
    return saveSnippet(this.state, name, options);
  }

  snippets(): Promise<Snippet[]> {
    return this.state.snippetList();
  }

  deleteSnippet(name: string): Promise<boolean> {
    return deleteSnippet(this.state, name);
  }

  private async pass(exec: Execution): Promise<CodeOutput> {
    await runPass(this.state, exec);
    return this.save(exec);
  }

  private async load(executionId: string): Promise<Execution> {
    const exec = await this.state.store.getExecution(executionId);
    if (!exec) throw new CodemodeError("NOT_FOUND", `no execution ${executionId}`);
    return exec;
  }

  /** Persists the execution, runs hooks, and shapes the tool output. */
  private async save(exec: Execution): Promise<CodeOutput> {
    exec.updatedAt = Date.now();
    const raw = exec.result;
    if (exec.status === "completed" && (JSON.stringify(raw) ?? "").length > this.state.maxValueBytes) {
      exec.result = "[result omitted from the audit log: larger than the durable value limit]";
    }
    await this.state.store.putExecution(exec);
    await callHooks(this.state, exec);
    const budget = { maxTokens: this.state.config.runtime?.resultBudgetTokens ?? 6000 };
    const logs = exec.logs.length > 0 ? { logs: exec.logs } : {};
    if (exec.status === "completed") return { status: "completed", executionId: exec.id, result: truncateResult(raw, budget), ...logs };
    if (exec.status === "paused") return { status: "paused", executionId: exec.id, pending: exec.pending };
    return { status: "error", executionId: exec.id, error: exec.error ?? exec.status, ...logs };
  }
}

async function callHooks(state: RuntimeState, exec: Execution): Promise<void> {
  if (exec.status === "running") return;
  try {
    await state.hooks.onPassEnd?.(exec.id, exec.status);
    if (exec.status !== "paused") await state.hooks.disposeExecution?.(exec.id, exec.status);
  } catch {
    // Hooks must not throw; a failing one does not fail the execution.
  }
}
