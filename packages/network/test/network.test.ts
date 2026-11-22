// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusError } from "@the-protobuf-project/errors";
import { type JsonObject, StructCodec } from "@the-protobuf-project/protobuf";
import { connectHandler, connectTransport, type Fetch, httpTransport, type MethodDescriptor } from "../src/index.ts";

const createBook: MethodDescriptor<JsonObject, JsonObject> = {
  service: "library.v1.LibraryService",
  name: "CreateBook",
  input: StructCodec,
  output: StructCodec,
  http: { method: "POST", path: "/v1/{parent=shelves/*}/books", body: "book" },
};

function recorder(response: Response): { fetch: Fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response.clone();
    },
  };
}

test("httpTransport binds path, body and query from the http rule", async () => {
  const { fetch, calls } = recorder(Response.json({ name: "shelves/a/books/1" }));
  const t = httpTransport({ baseUrl: "https://api.test/", fetch, headers: { authorization: "Bearer x" } });
  const out = await t.unary(createBook, { parent: "shelves/a", book: { title: "T" }, requestId: "r1" });
  assert.deepEqual(out, { name: "shelves/a/books/1" });
  assert.equal(calls[0]?.url, "https://api.test/v1/shelves/a/books?requestId=r1");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.body, JSON.stringify({ title: "T" }));
  const headers = calls[0]?.init.headers as Record<string, string> | undefined;
  assert.equal(headers?.authorization, "Bearer x");
});

test("httpTransport fails before sending when a path variable is missing", async () => {
  const { fetch, calls } = recorder(Response.json({}));
  await assert.rejects(httpTransport({ baseUrl: "https://api.test", fetch }).unary(createBook, {}), {
    code: "INVALID_ARGUMENT",
  });
  assert.equal(calls.length, 0);
});

test("httpTransport maps google.rpc.Status errors", async () => {
  const body = {
    error: {
      code: 404,
      status: "NOT_FOUND",
      message: "no shelf",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SHELF_MISSING" }],
    },
  };
  const { fetch } = recorder(Response.json(body, { status: 404 }));
  await assert.rejects(
    httpTransport({ baseUrl: "https://api.test", fetch }).unary(createBook, { parent: "shelves/x" }),
    (e) => {
      assert.ok(e instanceof StatusError);
      assert.equal(e.code, "NOT_FOUND");
      assert.equal(e.reason, "SHELF_MISSING");
      return true;
    },
  );
});

const echo = {
  descriptor: { typeName: "library.v1.LibraryService", methods: { createBook } },
  impl: {
    async createBook(req: JsonObject): Promise<JsonObject> {
      if (req.fail) throw new StatusError("ALREADY_EXISTS", "taken");
      return { echoed: req };
    },
  },
};

for (const format of ["json", "binary"] as const) {
  test(`connectTransport and connectHandler round-trip ${format}`, async () => {
    const handler = connectHandler([echo]);
    const t = connectTransport({
      baseUrl: "http://local",
      format,
      fetch: (url, init) => handler(new Request(url, init)),
    });
    assert.deepEqual(await t.unary(createBook, { parent: "shelves/a" }), { echoed: { parent: "shelves/a" } });
    await assert.rejects(t.unary(createBook, { fail: true }), { code: "ALREADY_EXISTS", message: "taken" });
  });
}

test("connectHandler rejects unknown routes as UNIMPLEMENTED", async () => {
  const res = await connectHandler([echo])(
    new Request("http://local/nope.Service/Method", { method: "POST", body: "{}" }),
  );
  assert.equal(res.status, 501);
  assert.equal(((await res.json()) as { code: string }).code, "unimplemented");
});
