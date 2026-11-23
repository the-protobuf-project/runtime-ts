// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { codeFromConnect, codeFromHttpStatus, StatusError } from "@the-protobuf-project/errors";
import { BinaryReader } from "@the-protobuf-project/protobuf";
import { bidiStream, clientStream, serverStream } from "./connect_stream.ts";
import {
  callHeaders,
  callSignal,
  type Duplex,
  type FetchTransportOptions,
  type Transport,
  transportError,
} from "./types.ts";

/** Options for the Connect transport. */
export interface ConnectTransportOptions extends FetchTransportOptions {
  /** "json" (default) or "binary" (application/proto). */
  format?: "json" | "binary";
  /**
   * A full-duplex connection for bidi streaming, which fetch cannot make: `http2Duplex()`
   * from `@the-protobuf-project/network/node` in Bun, Node and Deno.
   */
  duplex?: Duplex;
}

/** A Connect transport, which always has the streaming calls. */
export type ConnectTransport = Required<Transport>;

/**
 * Calls RPCs with the Connect protocol: a POST to /<package.Service>/<Method>. Works with
 * connect-go, connect-es, Envoy, and the Go and Rust HybridServers' Connect surface.
 *
 * Unary and server-streaming calls use fetch, so they work everywhere, browsers and Workers
 * included. Client streaming sends its requests in a streamed fetch body, then reads the
 * reply. Bidi needs `duplex`, a full-duplex connection.
 */
export function connectTransport(options: ConnectTransportOptions): ConnectTransport {
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

      let response: Response;
      let bytes: Uint8Array;
      try {
        response = await doFetch(`${base}/${method.service}/${method.name}`, init);
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (e) {
        throw transportError(e, signal);
      }
      if (!response.ok) throw connectError(response.status, new TextDecoder().decode(bytes));
      if (binary) return method.output.decode(new BinaryReader(bytes));
      const text = new TextDecoder().decode(bytes);
      return method.output.fromJson(text ? JSON.parse(text) : {});
    },
    serverStream: (method, request, callOptions) => serverStream(options, method, request, callOptions),
    clientStream: (method, requests, callOptions) => clientStream(options, method, requests, callOptions),
    bidiStream: (method, requests, callOptions) => bidiStream(options, method, requests, callOptions),
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
