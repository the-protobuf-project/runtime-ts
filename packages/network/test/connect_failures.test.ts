// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttp2Server, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { StringValueCodec } from "@the-protobuf-project/protobuf";
import { connectTransport, END_STREAM, envelope, type MethodDescriptor } from "../src/index.ts";
import { http2Duplex } from "../src/node.ts";

type Text = string | null;
const method = (name: string): MethodDescriptor<Text, Text> => ({
  service: "test.v1.Failing",
  name,
  input: StringValueCodec,
  output: StringValueCodec,
});
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** Silent never answers; Stalls answers once and then nothing; EndsEarly fails at once. */
function answer(name: string, write: (chunk: Uint8Array) => void, end: (chunk?: Uint8Array) => void): void {
  if (name === "Stalls") write(envelope(0, json("one")));
  if (name === "EndsEarly") end(envelope(END_STREAM, json({ error: { code: "not_found", message: "early" } })));
  if (name === "Endless") {
    const timer = setInterval(() => write(envelope(0, json("more"))), 5);
    endless.push(timer);
  }
}
const endless: NodeJS.Timeout[] = [];

const h2 = createHttp2Server();
h2.on("stream", (stream: ServerHttp2Stream, headers) => {
  stream.on("error", () => undefined);
  stream.resume();
  const name = String(headers[":path"]).split("/").pop() ?? "";
  if (name === "Silent") return;
  stream.respond({ ":status": 200, "content-type": "application/connect+json" });
  answer(
    name,
    (c) => stream.write(c),
    (c) => stream.end(c),
  );
});
h2.listen(0);
let endlessClosed = 0;
const h1 = createHttpServer((req, res) => {
  req.resume();
  const name = req.url?.split("/").pop() ?? "";
  if (name === "Silent") return;
  res.writeHead(200, { "content-type": "application/connect+json" });
  res.on("close", () => {
    if (name === "Endless") endlessClosed++;
  });
  answer(
    name,
    (c) => res.write(c),
    (c) => res.end(c),
  );
}).listen(0);
const duplex = http2Duplex();
after(() => {
  for (const t of endless) clearInterval(t);
  duplex.close();
  h1.closeAllConnections();
  h1.close();
  h2.close();
});
const url = (s: { address(): AddressInfo | string | null }) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

async function* stayOpen(): AsyncGenerator<Text> {
  yield "a";
  await new Promise(() => undefined);
}

async function* one(): AsyncGenerator<Text> {
  yield "a";
}

/** Reads a stream to its end; fails if that takes more than 3 s. */
async function drain(stream: AsyncIterable<Text>): Promise<Text[]> {
  const out: Text[] = [];
  const read = (async () => {
    for await (const v of stream) out.push(v);
    return out;
  })();
  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("HUNG")), 3000);
  });
  try {
    return await Promise.race([read, hung]);
  } finally {
    clearTimeout(timer);
  }
}

const bidi = connectTransport({ baseUrl: url(h2), duplex });
const fetched = connectTransport({ baseUrl: url(h1) });

test("bidi: a deadline before the response headers ends the call", async () => {
  await assert.rejects(drain(bidi.bidiStream(method("Silent"), stayOpen(), { timeoutMs: 200 })), {
    code: "DEADLINE_EXCEEDED",
  });
});

test("bidi: a deadline mid-stream ends the call with DEADLINE_EXCEEDED", async () => {
  await assert.rejects(drain(bidi.bidiStream(method("Stalls"), stayOpen(), { timeoutMs: 200 })), {
    code: "DEADLINE_EXCEEDED",
  });
});

test("bidi: an already-aborted signal is CANCELLED without a request", async () => {
  await assert.rejects(drain(bidi.bidiStream(method("Silent"), stayOpen(), { signal: AbortSignal.abort() })), {
    code: "CANCELLED",
  });
});

test("bidi: the server ending first ends the call while the requests are still open", async () => {
  await assert.rejects(drain(bidi.bidiStream(method("EndsEarly"), stayOpen())), { code: "NOT_FOUND" });
});

test("bidi: no server is UNAVAILABLE", async () => {
  const nowhere = connectTransport({ baseUrl: "http://127.0.0.1:1", duplex });
  await assert.rejects(drain(nowhere.bidiStream(method("X"), one())), { code: "UNAVAILABLE" });
});

test("fetch: a deadline mid-stream is DEADLINE_EXCEEDED, and no server is UNAVAILABLE", async () => {
  await assert.rejects(drain(fetched.serverStream(method("Stalls"), "a", { timeoutMs: 200 })), {
    code: "DEADLINE_EXCEEDED",
  });
  const nowhere = connectTransport({ baseUrl: "http://127.0.0.1:1" });
  await assert.rejects(drain(nowhere.serverStream(method("X"), "a")), { code: "UNAVAILABLE" });
  await assert.rejects(nowhere.unary(method("X"), "a"), { code: "UNAVAILABLE" });
});

test("fetch: a caller that stops reading stops the download", async () => {
  for await (const _ of fetched.serverStream(method("Endless"), "a")) break;
  for (let i = 0; i < 100 && endlessClosed === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(endlessClosed, 1);
});
