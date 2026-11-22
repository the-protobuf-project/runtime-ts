// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttp2Server, type Http2ServerRequest, type Http2ServerResponse } from "node:http2";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { BinaryReader, StringValueCodec } from "@the-protobuf-project/protobuf";
import { connectTransport, END_STREAM, envelope, envelopes, type MethodDescriptor } from "../src/index.ts";
import { http2Duplex } from "../src/node.ts";

/** google.protobuf.StringValue in and out, so the test needs no generated code. */
type Text = string | null;

const method = (name: string): MethodDescriptor<Text, Text> => ({
  service: "test.v1.Stream",
  name,
  input: StringValueCodec,
  output: StringValueCodec,
});

/**
 * A Connect streaming server: Repeat answers three times, Count once with how many it got,
 * Chat each message as it arrives, Fail once and then with an error.
 */
/** The part of an HTTP/1.1 or HTTP/2 response the test server uses. */
interface Reply {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: Uint8Array): boolean;
  end(chunk?: Uint8Array): unknown;
}

async function serve(
  req: IncomingMessage | Http2ServerRequest,
  out: ServerResponse | Http2ServerResponse,
): Promise<void> {
  const res = out as Reply;
  const binary = req.headers["content-type"] === "application/connect+proto";
  const read = (d: Uint8Array) =>
    binary
      ? StringValueCodec.decode(new BinaryReader(d))
      : StringValueCodec.fromJson(JSON.parse(new TextDecoder().decode(d)));
  const write = (v: Text) =>
    res.write(envelope(0, binary ? StringValueCodec.encode(v).finish() : new TextEncoder().encode(JSON.stringify(v))));
  const end = (body: object) => res.end(envelope(END_STREAM, new TextEncoder().encode(JSON.stringify(body))));
  res.writeHead(200, { "content-type": req.headers["content-type"] ?? "" });
  const name = req.url?.split("/").pop();
  let count = 0;
  for await (const { data } of envelopes(req as AsyncIterable<Uint8Array>)) {
    const value = read(data);
    count++;
    if (name === "Repeat") for (const i of [1, 2, 3]) write(`${value}-${i}`);
    if (name === "Chat") write(value?.toUpperCase() ?? null);
    if (name === "Fail") {
      write("first");
      end({ error: { code: "not_found", message: "gone" } });
      return;
    }
  }
  if (name === "Count") write(String(count));
  end({ metadata: { "x-count": [String(count)] } });
}

const h1 = createHttpServer((req, res) => void serve(req, res)).listen(0);
const h2 = createHttp2Server((req, res) => void serve(req, res)).listen(0);
const duplex = http2Duplex();
after(() => {
  duplex.close();
  h1.close();
  h2.close();
});
const base = (s: { address(): AddressInfo | string | null }) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

async function* items<T>(...values: T[]): AsyncGenerator<T> {
  for (const v of values) yield v;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of stream) out.push(v);
  return out;
}

for (const format of ["binary", "json"] as const) {
  test(`${format}: server streaming over fetch yields every reply`, async () => {
    const t = connectTransport({ baseUrl: base(h1), format });
    assert.deepEqual(await collect(t.serverStream(method("Repeat"), "a")), ["a-1", "a-2", "a-3"]);
  });

  test(`${format}: client streaming over fetch sends every request, then reads one reply`, async () => {
    const t = connectTransport({ baseUrl: base(h1), format });
    assert.equal(await t.clientStream(method("Count"), items("x", "y", "z")), "3");
  });
}

test("an error after a reply arrives as the stream's error, with its code", async () => {
  const t = connectTransport({ baseUrl: base(h1) });
  const seen: Text[] = [];
  await assert.rejects(
    (async () => {
      for await (const reply of t.serverStream(method("Fail"), "x")) seen.push(reply);
    })(),
    { code: "NOT_FOUND", message: "gone" },
  );
  assert.deepEqual(seen, ["first"]);
});

test("bidi over HTTP/2 is full duplex: each reply arrives before the next request is sent", async () => {
  const t = connectTransport({ baseUrl: base(h2), format: "binary", duplex });
  let answered: () => void = () => undefined;
  const firstReply = new Promise<void>((resolve) => {
    answered = resolve;
  });
  async function* requests() {
    yield "hello";
    await firstReply; // would never resolve if the call were half duplex
    yield "world";
  }
  const replies: Text[] = [];
  for await (const reply of t.bidiStream(method("Chat"), requests())) {
    replies.push(reply);
    answered();
  }
  assert.deepEqual(replies, ["HELLO", "WORLD"]);
});

test("bidi without a duplex connection says what it needs", async () => {
  const t = connectTransport({ baseUrl: base(h2) });
  await assert.rejects(collect(t.bidiStream(method("Chat"), items("x"))), {
    code: "UNIMPLEMENTED",
    message: /http2Duplex/,
  });
});
