// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// Code Mode: run model-written code against generated connectors in a
// sandbox, with approvals, replay, rollback and snippets. Sandboxes and
// surfaces live in their own entry points (codemode/quickjs, codemode/mcp, ...)
// so their dependencies stay optional.

export { type Description, describe, type SearchResult, type SearchResults, search } from "./catalog/search.ts";
export type { Catalog, CatalogMethod, CatalogNamespace, CatalogSnippet, CodemodeConfig } from "./catalog/types.ts";
export { type ConnectorSpec, connector, type UnaryMethodSpec, unaryMethod } from "./connector/connector.ts";
export type { CallContext, Connector, ConnectorMethod, ConnectorOptions, Replay } from "./connector/types.ts";
export { normalizeCode } from "./executor/normalize.ts";
export type { ExecuteRequest, ExecuteResult, Executor, HostCall } from "./executor/types.ts";
export { type CodemodeOptions, createCodemode } from "./runtime/create.ts";
export { CodemodeRuntime } from "./runtime/runtime.ts";
export type { SaveSnippetOptions } from "./runtime/snippets.ts";
export type { CodemodeTool } from "./runtime/tool.ts";
export { type TruncateOptions, truncateResult, truncateText } from "./runtime/truncate.ts";
export type {
  CodeInput,
  CodeOutput,
  Execution,
  ExecutionStatus,
  Hooks,
  LogEntry,
  PendingAction,
  RollbackResult,
  SerializedError,
  Snippet,
  TerminalStatus,
} from "./runtime/types.ts";
export { DEFAULT_MAX_EXECUTIONS, DEFAULT_PAUSED_TTL_MS, MAX_DURABLE_VALUE_BYTES } from "./runtime/values.ts";

export { MemoryStore } from "./store/memory.ts";
export { type DurableObjectSql, durableObjectSql, type SqliteDatabase, SqliteStore } from "./store/sqlite.ts";
export type { Store } from "./store/types.ts";
