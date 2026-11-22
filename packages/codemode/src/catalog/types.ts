// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Replay } from "../connector/types.ts";

/** One sandbox method, as the generator describes it. */
export interface CatalogMethod {
  /** "library.createBook" */
  readonly path: string;
  readonly namespace: string;
  readonly name: string;
  /** Fully qualified RPC, e.g. "library.v1.LibraryService.CreateBook". */
  readonly rpc: string;
  readonly description: string;
  readonly requiresApproval: boolean;
  readonly replay: Replay;
  readonly readOnly: boolean;
  /** The method that undoes this one on rollback, e.g. "library.deleteBook". */
  readonly revertedBy?: string;
  /** The method's signature, with its JSDoc. */
  readonly declaration: string;
  /** Sandbox names of every type the method's input and output reach. */
  readonly types: readonly string[];
  readonly examples: readonly string[];
}

/** One sandbox global. */
export interface CatalogNamespace {
  readonly name: string;
  readonly service: string;
  readonly instructions: string;
  /** `declare const <name>: { ... }` with every method. */
  readonly declaration: string;
  readonly methods: readonly string[];
}

/** A snippet shipped in the proto. */
export interface CatalogSnippet {
  readonly name: string;
  readonly description: string;
  readonly code: string;
  readonly inputType?: string;
}

/** Everything the sandbox exposes; generated as codemode/catalog.ts. */
export interface Catalog {
  /** Shared declarations: JSON types and the codemode global. */
  readonly prelude: string;
  /** Type declarations keyed by sandbox name. */
  readonly types: Readonly<Record<string, string>>;
  readonly namespaces: readonly CatalogNamespace[];
  readonly methods: readonly CatalogMethod[];
  readonly snippets: readonly CatalogSnippet[];
}

/** Runtime settings; generated as codemode/config.ts from codemode.yaml. */
export interface CodemodeConfig {
  /** progressive: namespaces in the tool description, details via describe(). inline: everything. */
  readonly discovery?: "progressive" | "inline";
  readonly executor?: {
    readonly timeoutMs?: number;
    readonly memoryMb?: number;
    readonly outbound?: "none" | "allowlist";
    readonly allow?: readonly string[];
  };
  readonly runtime?: {
    readonly maxExecutions?: number;
    readonly pausedTtlMs?: number;
    readonly maxValueBytes?: number;
    readonly resultBudgetTokens?: number;
  };
  readonly mcp?: { readonly expose?: "code" | "search_execute" };
}
