// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// Code Mode over any API with an OpenAPI 3.0 or 3.1 spec and no protos. For a service
// that has protos, generate instead: they carry reverts, resource names and richer hints.

import type { Fetch, FetchTransportOptions } from "@the-protobuf-project/network";
import type { Catalog } from "../catalog/types.ts";
import { connector } from "../connector/connector.ts";
import type { Connector, ConnectorMethod, ConnectorOptions } from "../connector/types.ts";
import { buildCatalog } from "./catalog.ts";
import { Document, node, text } from "./document.ts";
import { validNamespace } from "./names.ts";
import { type Operation, readOperations, type SkippedOperation } from "./operations.ts";
import { buildRequest } from "./request.ts";
import { send } from "./send.ts";

export type { SkippedOperation } from "./operations.ts";

const defaultMaxResponseBytes = 4 * 1024 * 1024;

/** Options for openApiConnector(). */
export interface OpenApiConnectorOptions extends ConnectorOptions, FetchTransportOptions {
  /** The sandbox global, e.g. "billing". */
  namespace: string;
  /** The only place requests go. The spec's own servers are ignored. */
  baseUrl: string;
  /** Guidance for the model. Defaults to the spec's title and description. */
  instructions?: string;
  /** Query parameters the host adds to every request, e.g. an API key. */
  query?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** The largest response read, in bytes. Defaults to 4 MiB. */
  maxResponseBytes?: number;
}

/** What openApiConnector() returns: pass both halves to createCodemode(). */
export interface OpenApiApi {
  readonly connector: Connector;
  readonly catalog: Catalog;
  /** Operations that are not in the sandbox, and why. */
  readonly skipped: readonly SkippedOperation[];
}

/**
 * Turns an OpenAPI spec into a sandbox namespace with one method per operation, typed from
 * its request and response schemas. A method takes one object: the parameters as fields,
 * and the request body as `body`.
 *
 * ```ts
 * const billing = openApiConnector(spec, {
 *   namespace: "billing",
 *   baseUrl: "https://billing.example.com",
 *   headers: () => ({ authorization: `Bearer ${token()}` }),
 *   approval: { searchInvoices: false },
 * });
 * createCodemode({ catalog: billing.catalog, connectors: [billing.connector], executor });
 * ```
 *
 * Requests run in the host. Every method but GET, HEAD and OPTIONS needs approval unless
 * `approval` says otherwise, and results are logged for replay. Credential, cookie and
 * method-override parameters are never sandbox inputs, and redirects are not followed.
 *
 * @param spec A parsed OpenAPI 3.0 or 3.1 document, or its JSON text.
 */
export function openApiConnector(spec: object | string, options: OpenApiConnectorOptions): OpenApiApi {
  const { namespace } = options;
  if (!validNamespace(namespace)) throw new Error(`openapi: ${JSON.stringify(namespace)} cannot be a sandbox global`);
  const base = parseBaseUrl(options.baseUrl);
  const doc = new Document(spec);
  const { operations, skipped } = readOperations(doc);

  const names = new Set(operations.map((op) => op.name));
  for (const name of [...Object.keys(options.approval ?? {}), ...(options.exclude ?? [])]) {
    // A typo must not silently leave a method unguarded or exposed.
    if (!names.has(name)) throw new Error(`openapi: there is no method ${namespace}.${name} to configure`);
  }
  const requiresApproval = (op: Operation) =>
    options.approval && Object.hasOwn(options.approval, op.name) ? options.approval[op.name] === true : !op.readOnly;

  const fetchImpl: Fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const settings = {
    fetch: fetchImpl,
    headers: resolver(options.headers),
    query: resolver(options.query),
    credentialNames: new Set(
      Object.values(node(node(doc.root.components).securitySchemes))
        .map((scheme) => text(doc.resolve(scheme).name).toLowerCase())
        .filter(Boolean),
    ),
    maxBytes: options.maxResponseBytes ?? defaultMaxResponseBytes,
  };

  const exposed = operations.filter((op) => !options.exclude?.includes(op.name));
  const methods = exposed.map(
    (op): ConnectorMethod => ({
      name: op.name,
      requiresApproval: requiresApproval(op),
      replay: "log",
      approvalMessage: `Allow ${op.method} ${op.path} on ${base.host}?`,
      execute: async (args, context) => send(settings, op, buildRequest(base, op, args), context.signal),
    }),
  );

  const catalog = buildCatalog(doc, namespace, options.instructions, exposed, requiresApproval);
  const guidance = catalog.namespaces[0]?.instructions;
  return {
    connector: connector({ namespace, methods, ...(guidance ? { instructions: guidance } : {}) }),
    catalog,
    skipped,
  };
}

function parseBaseUrl(value: string): URL {
  const base = new URL(value);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("openapi: baseUrl must be http(s)");
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("openapi: baseUrl cannot hold credentials, a query or a fragment; use headers or query");
  }
  return base;
}

function resolver(value: OpenApiConnectorOptions["query"]): () => Promise<Record<string, string>> {
  return async () => (typeof value === "function" ? await value() : (value ?? {}));
}
