// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { sandboxPrelude } from "./prelude.ts";
import type { Catalog } from "./types.ts";

/**
 * Joins catalogs, so generated services and OpenAPI APIs share one sandbox.
 *
 * ```ts
 * createCodemode({
 *   catalog: mergeCatalogs(catalog, billing.catalog),
 *   connectors: [...connectors(services), billing.connector],
 *   executor,
 * });
 * ```
 *
 * Throws when two catalogs define the same namespace, snippet, or type differently.
 */
export function mergeCatalogs(...catalogs: readonly Catalog[]): Catalog {
  const types = new Map<string, string>();
  const namespaces = new Set<string>();
  const snippets = new Set<string>();
  for (const catalog of catalogs) {
    for (const [name, declaration] of Object.entries(catalog.types)) {
      const existing = types.get(name);
      if (existing !== undefined && existing !== declaration) {
        throw new Error(`two catalogs define the type ${name} differently`);
      }
      types.set(name, declaration);
    }
    for (const { name } of catalog.namespaces) {
      if (namespaces.has(name)) throw new Error(`two catalogs define the namespace ${name}`);
      namespaces.add(name);
    }
    for (const { name } of catalog.snippets) {
      if (snippets.has(name)) throw new Error(`two catalogs define the snippet ${name}`);
      snippets.add(name);
    }
  }
  return {
    prelude: catalogs[0]?.prelude ?? sandboxPrelude,
    types: Object.fromEntries(types),
    namespaces: catalogs.flatMap((c) => c.namespaces),
    methods: catalogs.flatMap((c) => c.methods),
    snippets: catalogs.flatMap((c) => c.snippets),
  };
}
