// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import { node } from "./document.ts";
import type { Operation } from "./operations.ts";
import type { Parameter } from "./parameters.ts";

/** A request built from sandbox arguments, before the host's headers are added. */
export interface BuiltRequest {
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

function bad(message: string): StatusError {
  return new StatusError("INVALID_ARGUMENT", message);
}

/** A scalar as text; nested values are sent as JSON. */
function scalar(value: unknown): string {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Builds an operation's request from sandbox arguments. The arguments come from
 * model-written code: they can fill in declared parameters and nothing else, and cannot
 * move the request off the operation's path or the base URL.
 */
export function buildRequest(base: URL, op: Operation, args: unknown): BuiltRequest {
  if (args !== null && args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    throw bad(`${op.name} takes one object`);
  }
  const input = node(args);
  const known = new Set(op.parameters.map((p) => p.key));
  if (op.body) known.add("body");
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw bad(`${op.name} has no input ${JSON.stringify(key)}`);
  }

  const query = new URLSearchParams();
  const headers: Record<string, string> = { accept: op.accept };
  const path = new Map<string, string>();
  for (const p of op.parameters) {
    const value = Object.hasOwn(input, p.key) ? input[p.key] : undefined;
    if (value === undefined || value === null) {
      if (p.required) throw bad(`${op.name}: ${p.key} is required`);
    } else if (p.in === "path") {
      path.set(p.name, pathValue(p, value));
    } else if (p.in === "query") {
      addQuery(query, p, value);
    } else {
      const header = simple(p, value, (s) => s);
      if (/[\r\n\0]/.test(header)) throw bad(`${p.key} cannot hold a line break`);
      headers[p.name.toLowerCase()] = header;
    }
  }

  const filled = op.path.replace(/\{([^}]*)\}/g, (_, name: string) => path.get(name) ?? "");
  // Assigning pathname cannot change the origin, but it does resolve dot segments.
  if (filled.split("/").some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) {
    throw bad(`${op.name}: the path has a dot segment`);
  }
  const url = new URL(base);
  url.pathname = base.pathname.replace(/\/+$/, "") + filled;
  url.search = query.toString();

  const built: BuiltRequest = { url, headers };
  if (op.body) {
    const value = Object.hasOwn(input, "body") ? input.body : undefined;
    if (value === undefined) {
      if (op.body.required) throw bad(`${op.name}: body is required`);
    } else {
      headers["content-type"] = op.body.mediaType;
      built.body = encodeBody(op, value);
    }
  }
  return built;
}

function encodeBody(op: Operation, value: unknown): string {
  if (op.body?.kind === "json") return JSON.stringify(value);
  if (op.body?.kind === "text") {
    if (typeof value !== "string") throw bad(`${op.name}: body must be a string`);
    return value;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bad(`${op.name}: body must be an object`);
  }
  const form = new URLSearchParams();
  for (const [key, field] of Object.entries(value)) {
    for (const v of Array.isArray(field) ? field : [field]) {
      if (v !== null && v !== undefined) form.append(key, scalar(v));
    }
  }
  return form.toString();
}

/** One path value, encoded so that it stays inside its segment. */
function pathValue(p: Parameter, value: unknown): string {
  const raw = p.json ? JSON.stringify(value) : simple(p, value, (s) => s);
  // Servers that decode %2F would also resolve the dot segments behind it.
  if (raw === "" || raw.split(/[/\\]/).some((part) => /^(\.|%2e){1,2}$/i.test(part))) {
    throw bad(`${p.key} is not a usable path value`);
  }
  return p.json ? encodeURIComponent(raw) : simple(p, value, encodeURIComponent);
}

/** The "simple" style of path and header parameters. */
function simple(p: Parameter, value: unknown, encode: (s: string) => string): string {
  if (p.json) return encode(JSON.stringify(value));
  if (Array.isArray(value)) return value.map((v) => encode(scalar(v))).join(",");
  if (value !== null && typeof value === "object") {
    const pairs = Object.entries(value).map(([k, v]) => [encode(k), encode(scalar(v))]);
    return pairs.map((pair) => pair.join(p.explode ? "=" : ",")).join(",");
  }
  return encode(String(value));
}

function addQuery(query: URLSearchParams, p: Parameter, value: unknown): void {
  if (p.json) {
    query.append(p.name, JSON.stringify(value));
  } else if (Array.isArray(value)) {
    if (value.length === 0) return;
    if (p.explode) for (const v of value) query.append(p.name, scalar(v));
    else query.append(p.name, value.map(scalar).join(separator(p.style)));
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (p.style === "deepObject") {
      for (const [k, v] of entries) {
        if (!/^[\w.-]+$/.test(k)) throw bad(`${p.key}: ${JSON.stringify(k)} is not a usable key`);
        query.append(`${p.name}[${k}]`, scalar(v));
      }
    } else if (p.explode) {
      for (const [k, v] of entries) {
        // Exploded keys become query names, so only declared ones may pass.
        if (!p.fields.includes(k)) throw bad(`${p.key} has no field ${JSON.stringify(k)}`);
        query.append(k, scalar(v));
      }
    } else {
      query.append(p.name, entries.flatMap(([k, v]) => [k, scalar(v)]).join(separator(p.style)));
    }
  } else {
    query.append(p.name, String(value));
  }
}

function separator(style: string): string {
  if (style === "spaceDelimited") return " ";
  return style === "pipeDelimited" ? "|" : ",";
}
