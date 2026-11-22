// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { codeFromHttpStatus, codeFromNumber, isCode, StatusError } from "@the-protobuf-project/errors";
import type { JsonObject, JsonValue } from "@the-protobuf-project/protobuf";
import { deletePath, expandPath, getPath, jsonPath, toQuery } from "./path_template.ts";
import { callHeaders, callSignal, type FetchTransportOptions, type Transport } from "./types.ts";

/**
 * Calls RPCs through their google.api.http bindings, with protojson bodies.
 * Use it for gRPC-gateway, ESPv2, Envoy transcoding or any REST server that
 * follows AIP-127.
 */
export function httpTransport(options: FetchTransportOptions): Transport {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");

  return {
    async unary(method, request, callOptions) {
      const rule = method.http;
      if (!rule) {
        throw new StatusError("UNIMPLEMENTED", `${method.service}.${method.name} has no google.api.http binding`);
      }
      const json = structuredClone(method.input.toJson(request)) as JsonObject;
      const { path, bound } = expandPath(rule.path, json);
      for (const p of bound) deletePath(json, p);

      let body: JsonValue | undefined;
      if (rule.body === "*") {
        body = json;
      } else if (rule.body) {
        const p = jsonPath(rule.body);
        body = getPath(json, p) ?? {};
        deletePath(json, p);
      }
      const query = rule.body === "*" ? "" : toQuery(json).toString();
      const url = `${base}${path}${query ? `?${query}` : ""}`;

      const headers = await callHeaders(options.headers, callOptions, {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      });
      const init: RequestInit = { method: rule.method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      const signal = callSignal(callOptions);
      if (signal) init.signal = signal;

      const response = await doFetch(url, init);
      const text = await response.text();
      if (!response.ok) throw httpError(response.status, text);
      let data: unknown = text ? JSON.parse(text) : {};
      if (rule.responseBody) data = { [jsonPath(rule.responseBody).join(".")]: data };
      return method.output.fromJson(data);
    },
  };
}

/** Reads google.rpc.Status, or Google's {"error": {...}} envelope, from an error body. */
export function httpError(status: number, text: string): StatusError {
  let parsed: Record<string, unknown> = {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object") parsed = v as Record<string, unknown>;
  } catch {
    // Not JSON: keep the HTTP status and raw text.
  }
  const inner = (parsed.error && typeof parsed.error === "object" ? parsed.error : parsed) as Record<string, unknown>;
  const statusName = inner.status;
  const code = isCode(statusName)
    ? statusName
    : typeof inner.code === "number" && inner.code < 17
      ? codeFromNumber(inner.code)
      : codeFromHttpStatus(status);
  const message = typeof inner.message === "string" ? inner.message : text || `HTTP ${status}`;
  const details = Array.isArray(inner.details) ? (inner.details as unknown[]) : undefined;
  const info = details?.find((d) =>
    (d as Record<string, unknown>)?.["@type"]?.toString().endsWith("google.rpc.ErrorInfo"),
  );
  const reason = (info as Record<string, unknown> | undefined)?.reason;
  return new StatusError(code, message, {
    ...(typeof reason === "string" ? { reason } : {}),
    ...(details ? { details } : {}),
  });
}
