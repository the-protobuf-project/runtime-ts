// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Catalog, CatalogMethod, CodemodeConfig } from "../catalog/types.ts";
import type { Connector, ConnectorMethod } from "../connector/types.ts";
import { normalizeCode } from "../executor/normalize.ts";
import type { Executor } from "../executor/types.ts";
import { MemoryStore } from "../store/memory.ts";
import type { Store } from "../store/types.ts";
import type { Hooks, Snippet } from "./types.ts";
import { DEFAULT_MAX_EXECUTIONS, DEFAULT_PAUSED_TTL_MS, MAX_DURABLE_VALUE_BYTES } from "./values.ts";

/** Options for createCodemode(). */
export interface CodemodeOptions {
  /** The generated catalog (codemode/catalog.ts). */
  catalog: Catalog;
  /** The generated connectors, built from your service implementations. */
  connectors: readonly Connector[];
  executor: Executor;
  /** Where executions and snippets live. Defaults to memory. */
  store?: Store;
  /** Runtime settings; pass the generated config to follow codemode.yaml. */
  config?: CodemodeConfig;
  hooks?: Hooks;
}

/** A sandbox method and the namespace it belongs to. */
export interface BoundMethod {
  namespace: string;
  method: ConnectorMethod;
}

/** What every runtime operation shares, resolved once from the options. */
export class RuntimeState {
  readonly catalog: Catalog;
  readonly methods = new Map<string, BoundMethod>();
  readonly executor: Executor;
  readonly store: Store;
  readonly hooks: Hooks;
  readonly config: CodemodeConfig;
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly maxValueBytes: number;
  readonly maxExecutions: number;
  readonly pausedTtlMs: number;
  private seeded: Promise<void> | undefined;

  constructor(options: CodemodeOptions) {
    this.executor = options.executor;
    this.store = options.store ?? new MemoryStore();
    this.hooks = options.hooks ?? {};
    this.config = options.config ?? {};
    this.timeoutMs = this.config.executor?.timeoutMs ?? 30_000;
    this.memoryMb = this.config.executor?.memoryMb ?? 64;
    this.maxValueBytes = this.config.runtime?.maxValueBytes ?? MAX_DURABLE_VALUE_BYTES;
    this.maxExecutions = this.config.runtime?.maxExecutions ?? DEFAULT_MAX_EXECUTIONS;
    this.pausedTtlMs = this.config.runtime?.pausedTtlMs ?? DEFAULT_PAUSED_TTL_MS;
    for (const c of options.connectors) {
      if (c.namespace === "codemode") throw new Error(`the namespace "codemode" is reserved`);
      for (const m of Object.values(c.methods)) {
        const path = `${c.namespace}.${m.name}`;
        if (this.methods.has(path)) throw new Error(`two connectors define ${path}`);
        this.methods.set(path, { namespace: c.namespace, method: m });
      }
    }
    this.catalog = effectiveCatalog(options.catalog, this.methods);
  }

  /** Method names per namespace, for the sandbox prelude. */
  namespaceMethods(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [path, b] of this.methods) (out[b.namespace] ??= []).push(path.slice(b.namespace.length + 1));
    return out;
  }

  /** Every snippet, after seeding the ones shipped in the catalog. */
  async snippetList(): Promise<Snippet[]> {
    this.seeded ??= this.seed();
    await this.seeded;
    return this.store.listSnippets();
  }

  private async seed(): Promise<void> {
    for (const s of this.catalog.snippets) {
      const existing = await this.store.getSnippet(s.name);
      if (existing?.source === "saved") continue;
      await this.store.putSnippet({
        name: s.name,
        description: s.description,
        code: normalizeCode(s.code),
        ...(s.inputType ? { inputType: s.inputType } : {}),
        source: "proto",
        createdAt: existing?.createdAt ?? Date.now(),
      });
    }
  }
}

/**
 * Narrows the generated catalog to what the connectors expose: excluded
 * methods disappear, approval overrides show up, and each namespace's
 * declaration is rebuilt from what is left.
 */
function effectiveCatalog(catalog: Catalog, methods: Map<string, BoundMethod>): Catalog {
  const kept: CatalogMethod[] = [];
  for (const m of catalog.methods) {
    const bound = methods.get(m.path);
    if (!bound) continue;
    if (bound.method.requiresApproval === m.requiresApproval) {
      kept.push(m);
      continue;
    }
    const note = "   * Requires approval: the execution pauses until a person approves this call.\n";
    const declaration = bound.method.requiresApproval
      ? m.declaration.replace(/^(\s*\/\*\*[\s\S]*?)(\s*\*\/)/, `$1\n${note.trimEnd()}$2`)
      : m.declaration.replace(/\n?\s*\* Requires approval:[^\n]*/, "");
    kept.push({ ...m, requiresApproval: bound.method.requiresApproval, replay: bound.method.replay, declaration });
  }
  const namespaces = catalog.namespaces
    .filter((n) => kept.some((m) => m.namespace === n.name))
    .map((n) => {
      const own = kept.filter((m) => m.namespace === n.name);
      const doc = n.instructions ? `/** ${n.instructions.replaceAll("*/", "*\\/")} */\n` : "";
      const declaration = `${doc}declare const ${n.name}: {\n${own.map((m) => m.declaration).join("\n")}};\n`;
      return { ...n, declaration, methods: own.map((m) => m.path) };
    });
  return { ...catalog, namespaces, methods: kept };
}
