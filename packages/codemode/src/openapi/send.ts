// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import { type Fetch, httpError } from "@the-protobuf-project/network";
import type { JsonValue } from "@the-protobuf-project/protobuf";
import { isJson, type Operation } from "./operations.ts";
import type { BuiltRequest } from "./request.ts";

/** Host-side settings of every request. */
export interface SendOptions {
  fetch: Fetch;
  headers: () => Promise<Record<string, string>>;
  query: () => Promise<Record<string, string>>;
  /** Names the spec's security schemes send credentials under, lowercase. */
  credentialNames: ReadonlySet<string>;
  maxBytes: number;
}

const maxErrorLength = 2000;
const credentialName = /auth|cookie|password|secret|session|token|api[-_]?key/i;

/** The secret values the host sends, longest first, so echoes of them can be redacted. */
function secretsOf(sent: Record<string, string>, names: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(sent)) {
    if (!names.has(name.toLowerCase()) && !credentialName.test(name)) continue;
    out.add(value);
    // "Bearer <token>": a server may echo the token without its scheme.
    out.add(value.slice(value.indexOf(" ") + 1));
  }
  return [...out].filter((s) => s.length >= 6).sort((a, b) => b.length - a.length);
}

/**
 * Sends a built request with the host's credentials and returns what the sandbox may see.
 * Redirects are not followed, so credentials only ever go to the base URL.
 */
export async function send(
  options: SendOptions,
  op: Operation,
  request: BuiltRequest,
  signal: AbortSignal | undefined,
): Promise<JsonValue> {
  const [hostHeaders, hostQuery] = await Promise.all([options.headers(), options.query()]);
  // Set after the sandbox's, so the host's values win.
  const headers = { ...request.headers };
  for (const [name, value] of Object.entries(hostHeaders)) headers[name.toLowerCase()] = value;
  for (const [name, value] of Object.entries(hostQuery)) request.url.searchParams.set(name, value);

  const secrets = [
    ...secretsOf(hostHeaders, options.credentialNames),
    ...secretsOf(hostQuery, options.credentialNames),
  ];
  const redact = (value: string) => secrets.reduce((out, secret) => out.replaceAll(secret, "[redacted]"), value);

  const init: RequestInit = { method: op.method, headers, redirect: "manual" };
  if (request.body !== undefined) init.body = request.body;
  if (signal) init.signal = signal;

  let response: Response;
  let bytes: Uint8Array;
  try {
    response = await options.fetch(request.url.href, init);
    bytes = await readBody(response, options.maxBytes);
  } catch (e) {
    if (e instanceof StatusError) throw e;
    if (signal?.aborted) throw new StatusError("CANCELLED", `${op.name} was cancelled`);
    // fetch's own message can hold the URL, and with it a query credential.
    throw new StatusError("UNAVAILABLE", `${op.name}: ${op.method} ${op.path} got no response`);
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new StatusError("FAILED_PRECONDITION", `${op.name}: the server redirected, and redirects are not followed`);
  }
  if (!response.ok) {
    const error = httpError(response.status, redact(new TextDecoder().decode(bytes)));
    throw new StatusError(error.code, error.message.slice(0, maxErrorLength), {
      ...(error.reason ? { reason: error.reason } : {}),
      ...(error.details ? { details: error.details } : {}),
    });
  }
  if (bytes.length === 0) return null;

  const type = response.headers.get("content-type") ?? "";
  if (isJson(type) || (!type && op.results.some((r) => r.kind === "json"))) {
    try {
      return JSON.parse(redact(new TextDecoder().decode(bytes))) as JsonValue;
    } catch {
      throw new StatusError("INTERNAL", `${op.name}: the response is not valid JSON`);
    }
  }
  try {
    return redact(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return base64(bytes); // not text
  }
}

async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new StatusError("RESOURCE_EXHAUSTED", `the response is over ${maxBytes} bytes; ask for less`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
