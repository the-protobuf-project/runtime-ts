// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Catalog } from "../catalog/types.ts";
import type { Connector } from "../connector/types.ts";

export { type DurableObjectSql, durableObjectSql, SqliteStore } from "../store/sqlite.ts";
export { type WorkerLoader, WorkerLoaderExecutor, type WorkerLoaderExecutorOptions } from "./executor.ts";

/** The tool shape @cloudflare/codemode's CodemodeConnector.tools() returns. */
export interface CloudflareConnectorTool {
  description?: string;
  requiresApproval?: boolean;
  replay?: "log" | "reexecute";
  execute: (args: unknown) => Promise<unknown>;
  revert?: (args: unknown, result: unknown) => Promise<void>;
}

/**
 * Converts a generated connector to @cloudflare/codemode tools, for hosts
 * that run Cloudflare's durable runtime instead of this package's:
 *
 * ```ts
 * class Library extends CodemodeConnector {
 *   name() { return "library"; }
 *   tools() { return cloudflareTools(libraryServiceConnector(client), catalog); }
 * }
 * ```
 */
export function cloudflareTools(connector: Connector, catalog?: Catalog): Record<string, CloudflareConnectorTool> {
  const out: Record<string, CloudflareConnectorTool> = {};
  for (const m of Object.values(connector.methods)) {
    const description = catalog?.methods.find((c) => c.path === `${connector.namespace}.${m.name}`)?.description;
    const context = { executionId: "cloudflare" };
    const tool: CloudflareConnectorTool = {
      requiresApproval: m.requiresApproval,
      replay: m.replay,
      execute: (args) => m.execute(args, context),
      ...(description ? { description } : {}),
    };
    const revert = m.revert;
    if (revert) tool.revert = (args, result) => revert.call(m, args, result, context);
    out[m.name] = tool;
  }
  return out;
}
