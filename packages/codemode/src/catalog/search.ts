// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/runtime-ts-errors";
import type { Snippet } from "../runtime/types.ts";
import type { Catalog, CatalogMethod } from "./types.ts";

/** One search hit. */
export interface SearchResult {
  path: string;
  kind: "method" | "snippet";
  description?: string;
  requiresApproval?: boolean;
  score: number;
}

/** Ranked search hits, capped at the limit. */
export interface SearchResults {
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

/** TypeScript for one namespace, method or snippet. */
export interface Description {
  path: string;
  kind: "namespace" | "method" | "snippet";
  description?: string;
  requiresApproval?: boolean;
  types: string;
}

/** Splits text into lowercase words, breaking camelCase and snake_case. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function scoreOf(query: string[], fields: [string, number][]): number {
  let score = 0;
  for (const q of query) {
    let best = 0;
    for (const [text, weight] of fields) {
      for (const t of tokenize(text)) {
        if (t === q) best = Math.max(best, weight);
        else if (t.startsWith(q) || q.startsWith(t)) best = Math.max(best, weight / 2);
      }
    }
    score += best;
  }
  return score;
}

/** Ranks methods and snippets for a keyword query. */
export function search(catalog: Catalog, snippets: readonly Snippet[], query: string, limit = 50): SearchResults {
  const q = tokenize(query);
  const hits: SearchResult[] = [];
  for (const m of catalog.methods) {
    const ns = catalog.namespaces.find((n) => n.name === m.namespace);
    const score = q.length === 0 ? 0 : scoreOf(q, [[m.name, 4], [m.namespace, 2], [m.description, 1], [m.types.join(" "), 0.5], [ns?.instructions ?? "", 0.25]]);
    if (score > 0 || q.length === 0) {
      hits.push({ path: m.path, kind: "method", description: m.description, requiresApproval: m.requiresApproval, score });
    }
  }
  for (const s of snippets) {
    const score = q.length === 0 ? 0 : scoreOf(q, [[s.name, 4], [s.description ?? "", 1]]);
    if (score > 0 || q.length === 0) {
      hits.push({ path: s.name, kind: "snippet", ...(s.description ? { description: s.description } : {}), score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { results: hits.slice(0, limit), total: hits.length, truncated: hits.length > limit };
}

function typesFor(catalog: Catalog, names: readonly string[]): string {
  return names.map((n) => catalog.types[n] ?? "").filter(Boolean).join("\n");
}

function methodText(catalog: Catalog, m: CatalogMethod): string {
  const examples = m.examples.map((e) => `// Example:\n${e.split("\n").map((l) => `//   ${l}`).join("\n")}`);
  const decl = `declare const ${m.namespace}: {\n${m.declaration}};`;
  return [typesFor(catalog, m.types), decl, ...examples].filter(Boolean).join("\n\n");
}

/** Returns TypeScript for a namespace, a "namespace.method" path, or a snippet. */
export function describe(catalog: Catalog, snippets: readonly Snippet[], target: string): Description {
  const ns = catalog.namespaces.find((n) => n.name === target);
  if (ns) {
    const methods = catalog.methods.filter((m) => m.namespace === ns.name);
    const names = [...new Set(methods.flatMap((m) => m.types))].sort();
    return { path: ns.name, kind: "namespace", description: ns.instructions, types: `${typesFor(catalog, names)}\n\n${ns.declaration}` };
  }
  const m = catalog.methods.find((x) => x.path === target);
  if (m) {
    return { path: m.path, kind: "method", description: m.description, requiresApproval: m.requiresApproval, types: methodText(catalog, m) };
  }
  const s = snippets.find((x) => x.name === target);
  if (s) {
    const input = s.inputType ? `${catalog.types[s.inputType] ?? ""}\n` : "";
    const call = `// Run with: await codemode.run(${JSON.stringify(s.name)}${s.inputType ? `, input as ${s.inputType}` : ""})`;
    return { path: s.name, kind: "snippet", ...(s.description ? { description: s.description } : {}), types: `${input}${call}\n${s.code}` };
  }
  throw new StatusError("NOT_FOUND", `nothing named ${JSON.stringify(target)}; use codemode.search() to find methods`);
}
