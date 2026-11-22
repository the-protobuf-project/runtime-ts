// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Catalog, mergeCatalogs } from "../src/index.ts";
import { openApiConnector } from "../src/openapi/index.ts";
import { shop, spec } from "./openapi_fixture.ts";

test("each operation is a typed method, and unsupported ones are reported", async () => {
  const { api, runtime } = shop();
  assert.deepEqual(
    api.catalog.methods.map((m) => m.name),
    ["booksListBooks", "booksCreateBook", "booksGetBook", "booksDeleteBook", "booksSearchBooks"],
  );
  assert.equal(api.skipped[0]?.operation, "Books_PutCover");
  assert.match(api.skipped[0]?.reason ?? "", /multipart/);

  const { types } = await runtime.describe("shop.booksCreateBook");
  assert.match(types, /booksCreateBook\(input: ShopBooksCreateBookInput\): Promise<ShopBook>/);
  assert.match(types, /body: ShopBook;/);
  assert.match(types, /id\?: string;/, "read-only fields are optional, so requests can leave them out");
  assert.match(types, /state\?: "IN_STOCK" \| "SOLD";/);
  assert.match(types, /parent\?: ShopBook;/, "allOf around one reference is that type");
  assert.match((await runtime.describe("shop.booksDeleteBook")).types, /Promise<null>/);
});

test("parameters follow their OpenAPI styles", async () => {
  const { seen, attempt } = shop();
  await attempt(`shop.booksListBooks({
    tag: ["new", "used"], ids: [1, 2], where: { author: "x&y" }, page: { size: 5 }, "X-Region": "eu",
  })`);
  const [request] = seen;
  assert.ok(request);
  assert.equal(request.url.origin + request.url.pathname, "https://shop.test/api/books");
  assert.deepEqual(request.url.searchParams.getAll("tag"), ["new", "used"]);
  assert.equal(request.url.searchParams.get("ids"), "1,2");
  assert.equal(request.url.searchParams.get("where[author]"), "x&y");
  assert.equal(request.url.searchParams.get("size"), "5");
  assert.equal(request.headers["x-region"], "eu");
});

test("path values stay in their segment, and colon paths work", async () => {
  const { seen, attempt } = shop(undefined, { approval: { booksSearchBooks: false } });
  await attempt(`shop.booksGetBook({ id: "a/b?c#d" })`);
  await attempt("shop.booksSearchBooks()");
  assert.deepEqual(
    seen.map((r) => r.url.pathname),
    ["/api/books/a%2Fb%3Fc%23d", "/api/books:search"],
  );
});

test("writes pause, and resume without repeating the read before them", async () => {
  const { runtime, seen } = shop(({ init }) =>
    init.method === "POST" ? Response.json({ id: "2", title: "Odes" }, { status: 201 }) : Response.json([]),
  );
  const paused = await runtime.execute({
    code: `async () => {
      const before = await shop.booksListBooks();
      const book = await shop.booksCreateBook({ body: { title: "Odes" } });
      return [before.length, book.id];
    }`,
  });
  assert.equal(paused.status, "paused", JSON.stringify(paused));
  assert.equal(seen.length, 1, "nothing is written before approval");
  if (paused.status !== "paused") return;
  assert.equal(paused.pending[0]?.message, "Allow POST /books on shop.test?");

  const done = await runtime.approve({ executionId: paused.executionId, seq: paused.pending[0]?.seq ?? 0 });
  assert.equal(done.status, "completed", JSON.stringify(done));
  if (done.status === "completed") assert.deepEqual(done.result, [0, "2"]);
  assert.deepEqual(
    seen.map((r) => r.init.method),
    ["GET", "POST"],
  );
  assert.equal(seen[1]?.init.body, '{"title":"Odes"}');
});

test("approval and exclude apply to the catalog as well", () => {
  const { api } = shop(undefined, { approval: { booksGetBook: true }, exclude: ["booksDeleteBook"] });
  const get = api.catalog.methods.find((m) => m.name === "booksGetBook");
  assert.equal(get?.requiresApproval, true);
  assert.match(get?.declaration ?? "", /Requires approval/);
  assert.equal(api.connector.methods.booksDeleteBook, undefined);
  assert.ok(!api.catalog.namespaces[0]?.declaration.includes("booksDeleteBook"));
});

test("errors keep the server's code, and empty bodies are null", async () => {
  const { attempt } = shop(({ url }) =>
    url.pathname.endsWith("/none")
      ? new Response(null, { status: 204 })
      : Response.json({ error: { code: 404, status: "NOT_FOUND", message: "no such book" } }, { status: 404 }),
  );
  assert.deepEqual(await attempt(`shop.booksGetBook({ id: "x" })`), { code: "NOT_FOUND", message: "no such book" });
  assert.equal(await attempt(`shop.booksGetBook({ id: "none" })`), null);
});

test("a repeated operationId is one method: gnostic writes one per additional binding", () => {
  const get = { operationId: "Books_GetBook", responses: {} };
  const paths = { "/v1/book": { get }, "/v1/books:get": { get } };
  const api = openApiConnector({ openapi: "3.0.3", paths }, { namespace: "shop", baseUrl: "https://shop.test" });
  assert.deepEqual(Object.keys(api.connector.methods), ["booksGetBook"]);
  assert.match(api.skipped[0]?.reason ?? "", /books:get repeats/);
});

test("catalogs merge, and refuse to overlap", () => {
  const a = openApiConnector(spec, { namespace: "first", baseUrl: "https://a.test" }).catalog;
  const b = openApiConnector(spec, { namespace: "second", baseUrl: "https://b.test" }).catalog;
  const merged: Catalog = mergeCatalogs(a, b);
  assert.deepEqual(
    merged.namespaces.map((n) => n.name),
    ["first", "second"],
  );
  assert.ok(merged.types.FirstBook && merged.types.SecondBook);
  assert.throws(() => mergeCatalogs(a, a), /namespace first/);
});
