// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { codeFromConnect, codeFromHttpStatus, StatusError } from "@the-protobuf-project/errors";
import { BinaryReader } from "@the-protobuf-project/protobuf";
import { callHeaders, callSignal, type FetchTransportOptions, type Transport } from "./types.ts";

/** Options for the Connect transport. */
export interface ConnectTransportOptions extends FetchTransportOptions {
  /** "json" (default) or "binary" (application/proto). */
  format?: "json" | "binary";
}

/**
 * Calls RPCs with the Connect protocol's unary requests: a POST to
 * /<package.Service>/<Method>. Works with connect-go, connect-es and Envoy.
 */
export function connectTransport(options: ConnectTransportOptions): Transport {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
  const binary = options.format === "binary";

  return {
    async unary(method, request, callOptions) {
      const contentType = binary ? "application/proto" : "application/json";
      const extra: Record<string, string> = { "content-type": contentType, "connect-protocol-version": "1" };
      if (callOptions?.timeoutMs) extra["connect-timeout-ms"] = String(callOptions.timeoutMs);
      const init: RequestInit = {
        method: "POST",
        headers: await callHeaders(options.headers, callOptions, extra),
        body: binary
          ? (method.input.encode(request).finish() as Uint8Array<ArrayBuffer>)
          : JSON.stringify(method.input.toJson(request)),
      };
      const signal = callSignal(callOptions);
      if (signal) init.signal = signal;

      const response = await doFetch(`${base}/${method.service}/${method.name}`, init);
      if (!response.ok) throw connectError(response.status, await response.text());
      if (binary) return method.output.decode(new BinaryReader(new Uint8Array(await response.arrayBuffer())));
      const text = await response.text();
      return method.output.fromJson(text ? JSON.parse(text) : {});
    },
  };
}

/** Reads a Connect error body: {"code": "not_found", "message": "...", "details": [...]}. */
export function connectError(status: number, text: string): StatusError {
  try {
    const v = JSON.parse(text) as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof v.code === "string") {
      return new StatusError(codeFromConnect(v.code), typeof v.message === "string" ? v.message : v.code, {
        ...(Array.isArray(v.details) ? { details: v.details } : {}),
      });
    }
  } catch {
    // Fall through to the HTTP status.
  }
  return new StatusError(codeFromHttpStatus(status), text || `HTTP ${status}`);
}
