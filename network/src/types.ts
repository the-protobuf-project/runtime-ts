// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { MessageCodec } from "@the-protobuf-project/runtime-ts/protobuf";

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

/** Sends unary RPCs. Generated clients take one. */
export interface Transport {
  unary<I, O>(method: MethodDescriptor<I, O>, request: I, options?: CallOptions): Promise<O>;
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
