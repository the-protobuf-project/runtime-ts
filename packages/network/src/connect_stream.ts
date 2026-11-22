// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import { BinaryReader } from "@the-protobuf-project/protobuf";
import type { ConnectTransportOptions } from "./connect.ts";
import { connectError } from "./connect.ts";
import { COMPRESSED, chunks, END_STREAM, endStreamError, envelope, envelopes } from "./envelope.ts";
import { type CallOptions, callHeaders, callSignal, type MethodDescriptor } from "./types.ts";

/** How one stream's messages are written and read: binary or JSON. */
interface Codec<I, O> {
  contentType: string;
  encode(message: I): Uint8Array;
  decode(data: Uint8Array): O;
}

function codec<I, O>(method: MethodDescriptor<I, O>, binary: boolean): Codec<I, O> {
  if (binary) {
    return {
      contentType: "application/connect+proto",
      encode: (m) => method.input.encode(m).finish(),
      decode: (d) => method.output.decode(new BinaryReader(d)),
    };
  }
  const text = new TextEncoder();
  const read = new TextDecoder();
  return {
    contentType: "application/connect+json",
    encode: (m) => text.encode(JSON.stringify(method.input.toJson(m))),
    decode: (d) => method.output.fromJson(JSON.parse(read.decode(d) || "{}")),
  };
}

/** A streaming call's URL and headers. */
async function prepare<I, O>(
  options: ConnectTransportOptions,
  method: MethodDescriptor<I, O>,
  callOptions: CallOptions | undefined,
): Promise<{ url: string; headers: Record<string, string>; codec: Codec<I, O> }> {
  const c = codec(method, options.format === "binary");
  const extra: Record<string, string> = { "content-type": c.contentType, "connect-protocol-version": "1" };
  if (callOptions?.timeoutMs) extra["connect-timeout-ms"] = String(callOptions.timeoutMs);
  return {
    url: `${options.baseUrl.replace(/\/+$/, "")}/${method.service}/${method.name}`,
    headers: await callHeaders(options.headers, callOptions, extra),
    codec: c,
  };
}

/** The replies of a stream, ending at its end-stream envelope, which throws a failed call's error. */
async function* replies<O>(body: AsyncIterable<Uint8Array>, decode: (d: Uint8Array) => O): AsyncGenerator<O> {
  for await (const { flags, data } of envelopes(body)) {
    if (flags & END_STREAM) {
      const error = endStreamError(data);
      if (error) throw error;
      return;
    }
    if (flags & COMPRESSED) throw new StatusError("INTERNAL", "compressed messages are not supported");
    yield decode(data);
  }
  throw new StatusError("INTERNAL", "the stream ended without an end-stream message");
}

/** The requests as envelopes. */
async function* outgoing<I>(requests: AsyncIterable<I>, encode: (m: I) => Uint8Array): AsyncGenerator<Uint8Array> {
  for await (const request of requests) yield envelope(0, encode(request));
}

/** A ReadableStream over an async iterable, for a fetch request body. */
function readable(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

async function* single(message: Uint8Array): AsyncGenerator<Uint8Array> {
  yield message;
}

/** A Connect stream over fetch; the request body is sent before the response is read. */
async function fetchStream<O>(
  options: ConnectTransportOptions,
  url: string,
  headers: Record<string, string>,
  body: AsyncIterable<Uint8Array>,
  callOptions: CallOptions | undefined,
  decode: (d: Uint8Array) => O,
): Promise<AsyncGenerator<O>> {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const init: RequestInit & { duplex?: "half" } = { method: "POST", headers, body: readable(body), duplex: "half" };
  const signal = callSignal(callOptions);
  if (signal) init.signal = signal;
  const response = await doFetch(url, init);
  if (!response.ok) throw connectError(response.status, await response.text());
  if (!response.body) throw new StatusError("INTERNAL", "the stream has no body");
  return replies(chunks(response.body), decode);
}

export async function* serverStream<I, O>(
  options: ConnectTransportOptions,
  method: MethodDescriptor<I, O>,
  request: I,
  callOptions?: CallOptions,
): AsyncGenerator<O> {
  const { url, headers, codec: c } = await prepare(options, method, callOptions);
  const body = single(envelope(0, c.encode(request)));
  yield* await fetchStream(options, url, headers, body, callOptions, c.decode);
}

export async function clientStream<I, O>(
  options: ConnectTransportOptions,
  method: MethodDescriptor<I, O>,
  requests: AsyncIterable<I>,
  callOptions?: CallOptions,
): Promise<O> {
  const { url, headers, codec: c } = await prepare(options, method, callOptions);
  const out: O[] = [];
  for await (const reply of await fetchStream(
    options,
    url,
    headers,
    outgoing(requests, c.encode),
    callOptions,
    c.decode,
  )) {
    out.push(reply);
  }
  if (out.length !== 1) throw new StatusError("INTERNAL", `a client stream answered ${out.length} messages, not 1`);
  return out[0] as O;
}

export async function* bidiStream<I, O>(
  options: ConnectTransportOptions,
  method: MethodDescriptor<I, O>,
  requests: AsyncIterable<I>,
  callOptions?: CallOptions,
): AsyncGenerator<O> {
  if (!options.duplex) {
    throw new StatusError(
      "UNIMPLEMENTED",
      "bidi streaming needs a full-duplex connection, which fetch cannot make: pass duplex: http2Duplex() from @the-protobuf-project/network/node",
    );
  }
  const { url, headers, codec: c } = await prepare(options, method, callOptions);
  const signal = callSignal(callOptions);
  const response = await options.duplex.request({
    url,
    headers,
    body: outgoing(requests, c.encode),
    ...(signal ? { signal } : {}),
  });
  if (response.status !== 200) {
    let text = "";
    for await (const chunk of response.body) text += new TextDecoder().decode(chunk, { stream: true });
    throw connectError(response.status, text);
  }
  yield* replies(response.body, c.decode);
}
