// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { CodemodeError } from "../../errors/index.ts";

/** What sandboxed fetch() sends to the host. */
export interface OutboundRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/** What the host sends back; the sandbox wraps it as a Response-like object. */
export interface OutboundResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Reports whether host matches an allowlist entry: "api.example.com" or "*.example.com". */
export function allowed(host: string, allow: readonly string[]): boolean {
  return allow.some((a) => (a.startsWith("*.") ? host.endsWith(a.slice(1)) : host === a));
}

/**
 * Performs a sandboxed fetch for executor.outbound: allowlist. Only HTTPS
 * to listed hosts is allowed; the body is capped at maxBytes characters.
 */
export async function outboundFetch(
  req: OutboundRequest,
  allow: readonly string[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<OutboundResponse> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new CodemodeError("INVALID_ARGUMENT", `fetch: ${JSON.stringify(req.url)} is not a URL`);
  }
  if (url.protocol !== "https:" || !allowed(url.hostname, allow)) {
    throw new CodemodeError("PERMISSION_DENIED", `fetch: ${url.origin} is not in executor.allow`);
  }
  const init: RequestInit = { method: req.method ?? "GET", headers: req.headers ?? {}, signal, redirect: "manual" };
  if (req.body != null) init.body = req.body;
  const res = await fetch(url, init);
  const body = await res.text();
  if (body.length > maxBytes) throw new CodemodeError("RESOURCE_EXHAUSTED", `fetch: response is larger than ${maxBytes} characters`);
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}
