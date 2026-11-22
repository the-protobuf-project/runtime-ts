// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/**
 * The declarations every sandbox shares, for catalogs built at run time. Generated
 * catalogs carry the same text, from protoc-gen-codemode's sandbox template.
 */
export const sandboxPrelude = `/** Any JSON value. */
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
/** A JSON object. */
interface JsonObject { [key: string]: JsonValue }
/** google.protobuf.Empty. */
type Empty = Record<string, never>;
/** google.protobuf.Any: "@type" plus the packed message's fields. */
interface AnyMessage { "@type": string; [field: string]: unknown }

/** A search hit: a method or a saved snippet. */
interface CodemodeSearchResult {
  path: string;
  kind: "method" | "snippet";
  description?: string;
  requiresApproval?: boolean;
  score: number;
}

/** The error every failed call rejects with. Branch on code. */
interface CodemodeError extends Error {
  code: "CANCELLED" | "UNKNOWN" | "INVALID_ARGUMENT" | "DEADLINE_EXCEEDED" | "NOT_FOUND" | "ALREADY_EXISTS" | "PERMISSION_DENIED" | "RESOURCE_EXHAUSTED" | "FAILED_PRECONDITION" | "ABORTED" | "OUT_OF_RANGE" | "UNIMPLEMENTED" | "INTERNAL" | "UNAVAILABLE" | "DATA_LOSS" | "UNAUTHENTICATED";
  reason?: string;
  details?: unknown[];
}

declare const codemode: {
  /** Finds methods and snippets by keyword. */
  search(query: string): Promise<{ results: CodemodeSearchResult[]; total: number; truncated: boolean }>;
  /** Returns TypeScript for a namespace, "namespace.method", or snippet. */
  describe(target: string): Promise<{ path: string; kind: "namespace" | "method" | "snippet"; description?: string; requiresApproval?: boolean; types: string }>;
  /** Records a non-deterministic value (time, randomness) so replays reuse it. */
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  /** Runs a saved snippet. */
  run(name: string, input?: unknown): Promise<unknown>;
};
`;
