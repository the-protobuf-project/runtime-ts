// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { isStatusError, StatusError } from "@the-protobuf-project/errors";

import type { MessageCodec } from "@the-protobuf-project/protobuf";

/** A google.api.http binding. */
export interface HttpRule {
  readonly method: string;
  /** Path template, e.g. "/v1/{parent=shelves/*}/books". */
  readonly path: string;
  /** "*", a top-level request field, or absent for no body. */
  readonly body?: string;
  readonly responseBody?: string;
}

/** Everything a transport needs to call one RPC. */
export interface MethodDescriptor<I, O> {
  /** Fully qualified service name, e.g. "library.v1.LibraryService". */
  readonly service: string;
  /** RPC name, e.g. "CreateBook". */
  readonly name: string;
  readonly input: MessageCodec<I>;
  readonly output: MessageCodec<O>;
  readonly http?: HttpRule;
  readonly idempotency?: "NO_SIDE_EFFECTS" | "IDEMPOTENT";
}

/** Per-call options. */
export interface CallOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Abort the call after this many milliseconds. */
  timeoutMs?: number;
}

/**
 * Sends RPCs. Generated clients take one. Every transport sends unary calls; the streaming
 * methods are there when the protocol and the platform allow them.
 */
export interface Transport {
  unary<I, O>(method: MethodDescriptor<I, O>, request: I, options?: CallOptions): Promise<O>;
  /** One request, a stream of replies. */
  serverStream?<I, O>(method: MethodDescriptor<I, O>, request: I, options?: CallOptions): AsyncIterable<O>;
  /** A stream of requests, one reply once they are all sent. */
  clientStream?<I, O>(method: MethodDescriptor<I, O>, requests: AsyncIterable<I>, options?: CallOptions): Promise<O>;
  /** Requests and replies at the same time, over a full-duplex connection. */
  bidiStream?<I, O>(
    method: MethodDescriptor<I, O>,
    requests: AsyncIterable<I>,
    options?: CallOptions,
  ): AsyncIterable<O>;
}

/** One HTTP exchange whose request body streams while its response is read. */
export interface DuplexRequest {
  url: string;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  signal?: AbortSignal;
}

/** The response to a {@link DuplexRequest}: status, headers, and the body as it arrives. */
export interface DuplexResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
}

/**
 * Makes full-duplex HTTP exchanges, which fetch cannot: the request body is still being
 * sent while the response is read. Bidi streaming needs one; `http2Duplex()` from
 * `@the-protobuf-project/network/node` is the one for Bun, Node and Deno.
 */
export interface Duplex {
  request(request: DuplexRequest): Promise<DuplexResponse>;
}

/** The fetch function transports use; a Cloudflare service binding's fetch fits. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Options shared by the HTTP-based transports. */
export interface FetchTransportOptions {
  /** Base URL of the server, e.g. "https://api.example.com". */
  baseUrl: string;
  /** Defaults to globalThis.fetch. */
  fetch?: Fetch;
  /** Headers sent with every call, e.g. authorization. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

/**
 * What a failed exchange means to the caller: its own deadline is DEADLINE_EXCEEDED, its
 * own abort CANCELLED, and anything else that is not already a StatusError (no server, a
 * reset connection) UNAVAILABLE. The signal is checked first, because an aborted exchange
 * ends however the platform ends it.
 */
export function transportError(error: unknown, signal: AbortSignal | undefined): StatusError {
  if (signal?.aborted) {
    const reason: unknown = signal.reason;
    const timedOut = reason instanceof Error && reason.name === "TimeoutError";
    return timedOut
      ? new StatusError("DEADLINE_EXCEEDED", "the call ran past its deadline", { cause: reason })
      : new StatusError("CANCELLED", "the call was cancelled", { cause: reason });
  }
  if (isStatusError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new StatusError("UNAVAILABLE", `the server could not be reached: ${message}`, { cause: error });
}

/** Combines a caller's signal with a timeout. */
export function callSignal(options: CallOptions | undefined): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (options?.signal) signals.push(options.signal);
  if (options?.timeoutMs) signals.push(AbortSignal.timeout(options.timeoutMs));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Resolves static or dynamic headers and merges per-call ones. */
export async function callHeaders(
  base: FetchTransportOptions["headers"],
  options: CallOptions | undefined,
  extra: Record<string, string>,
): Promise<Record<string, string>> {
  const shared = typeof base === "function" ? await base() : (base ?? {});
  return { ...extra, ...shared, ...(options?.headers ?? {}) };
}
