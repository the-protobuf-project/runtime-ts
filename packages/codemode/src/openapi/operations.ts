// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { type Document, list, type Node, node, text } from "./document.ts";
import { camel, pascal } from "./names.ts";
import { isCredential, isOverride, type Parameter, readParameters } from "./parameters.ts";

/** A request body the connector can send. */
export interface Body {
  mediaType: string;
  kind: "json" | "form" | "text";
  required: boolean;
  schema: unknown;
}

/** One operation, checked and ready to become a sandbox method. */
export interface Operation {
  name: string;
  /** The operationId, or "GET /path". */
  id: string;
  method: string;
  path: string;
  summary: string;
  readOnly: boolean;
  parameters: Parameter[];
  body?: Body;
  /** Success responses, one schema per JSON body. */
  results: Result[];
  accept: string;
}

/** What a success response returns. */
export type Result = { kind: "json"; schema: unknown } | { kind: "text" } | { kind: "empty" };

/** An operation the connector cannot call faithfully, and why. */
export interface SkippedOperation {
  operation: string;
  reason: string;
}

const verbs = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const jsonMedia = /^(application|text)\/([\w.-]+\+)?json$/;

/** Reports whether a media type is JSON. */
export function isJson(mediaType: string): boolean {
  return jsonMedia.test(essence(mediaType));
}

function essence(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Reads every operation, setting aside the ones that cannot be called faithfully. */
export function readOperations(doc: Document): { operations: Operation[]; skipped: SkippedOperation[] } {
  const operations: Operation[] = [];
  const skipped: SkippedOperation[] = [];
  const seen = new Map<string, string>();
  const ids = new Set<string>();
  for (const [path, value] of Object.entries(node(doc.root.paths))) {
    if (!path.startsWith("/")) continue; // x- extensions
    const item = doc.resolve(value);
    for (const verb of verbs) {
      if (item[verb] === undefined) continue;
      const op = node(item[verb]);
      const method = verb.toUpperCase();
      const id = text(op.operationId) || `${method} ${path}`;
      if (ids.has(id)) {
        // gnostic repeats the operationId for additional_bindings. One RPC stays one method, so
        // the approval set on it cannot be walked around through another binding.
        skipped.push({ operation: id, reason: `${method} ${path} repeats its operationId; the first binding is used` });
        continue;
      }
      const read = readOperation(doc, item, op, method, path);
      if (typeof read === "string") {
        skipped.push({ operation: id, reason: read });
        continue;
      }
      const name = camel(text(op.operationId) || derivedId(verb, path));
      const other = seen.get(name);
      if (other) throw new Error(`openapi: ${other} and ${id} are both named ${name}; give them distinct operationIds`);
      seen.set(name, id);
      ids.add(id);
      operations.push({ ...read, name, id });
    }
  }
  return { operations, skipped };
}

/** A name for an operation without an operationId: get /users/{id} is getUsersById. */
function derivedId(verb: string, path: string): string {
  return verb + pascal(path.replace(/\{([^}]+)\}/g, " By $1 "));
}

function readOperation(
  doc: Document,
  item: Node,
  op: Node,
  method: string,
  path: string,
): Omit<Operation, "name" | "id"> | string {
  if (method === "TRACE") return "TRACE is not callable with fetch";
  if (list(op.servers).length > 0 || list(item.servers).length > 0) {
    return "it has its own server; give that server a connector of its own";
  }
  if (path.startsWith("//") || /[?#\\\s]/.test(path)) return "the path is not a plain URL path";

  const parameters = readParameters(doc, [...list(item.parameters), ...list(op.parameters)]);
  if (typeof parameters === "string") return parameters;
  for (const [, name = ""] of path.matchAll(/\{([^}]*)\}/g)) {
    if (isCredential(doc, "path", name) || isOverride(name)) return `the path carries a credential, ${name}`;
    if (!parameters.some((p) => p.in === "path" && p.name === name)) return `{${name}} is not a declared parameter`;
  }

  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const out: Omit<Operation, "name" | "id"> = {
    method,
    path,
    summary: [...new Set([text(op.summary), text(op.description)])].filter(Boolean).join("\n\n"),
    readOnly,
    parameters,
    results: [],
    accept: "application/json",
  };

  if (op.requestBody !== undefined) {
    if (method === "GET" || method === "HEAD") return `${method} with a request body is not callable with fetch`;
    const body = readBody(doc.resolve(op.requestBody));
    if (typeof body === "string") return body;
    if (body) out.body = body;
  }

  const accept = new Set<string>();
  for (const [status, value] of Object.entries(node(op.responses))) {
    if (!/^2(\d\d|XX)$/i.test(status)) continue;
    const content = Object.entries(node(doc.resolve(value).content));
    if (content.length > 0 && content.every(([type]) => essence(type) === "text/event-stream")) {
      return "it streams server-sent events, and a sandbox call returns one value";
    }
    const json = content.find(([type]) => isJson(type) || essence(type) === "*/*");
    const chosen = json ?? content[0];
    if (chosen) accept.add(chosen[0]);
    if (method === "HEAD" || !chosen) out.results.push({ kind: "empty" });
    else if (json) out.results.push({ kind: "json", schema: node(json[1]).schema });
    else out.results.push({ kind: "text" });
  }
  if (accept.size > 0) out.accept = [...accept].join(", ");
  return out;
}

function readBody(body: Node): Body | string | undefined {
  const content = Object.entries(node(body.content));
  if (content.length === 0) return undefined;
  const required = body.required === true;
  const pick = (test: (type: string) => boolean) => content.find(([type]) => test(essence(type)));

  const json = pick((t) => isJson(t) || t === "*/*");
  if (json) {
    const mediaType = isJson(json[0]) ? json[0] : "application/json";
    return { mediaType, kind: "json", required, schema: node(json[1]).schema };
  }
  const form = pick((t) => t === "application/x-www-form-urlencoded");
  if (form) return { mediaType: form[0], kind: "form", required, schema: node(form[1]).schema };
  const plain = pick((t) => t.startsWith("text/") && !t.includes("*"));
  if (plain) return { mediaType: plain[0], kind: "text", required, schema: { type: "string" } };
  return `request bodies of ${content.map(([type]) => type).join(", ")} are not supported`;
}
