// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { openApiConnector } from "../src/openapi/index.ts";
import { shop, spec } from "./openapi_fixture.ts";

const at = { namespace: "shop", baseUrl: "https://shop.test" };

test("requests only go to baseUrl, whatever the spec's servers say", async () => {
  const { seen, attempt } = shop();
  await attempt("shop.booksListBooks()");
  assert.equal(seen[0]?.url.origin, "https://shop.test");
});

test("path values cannot climb out of the operation", async () => {
  const { seen, attempt } = shop();
  for (const id of ["..", ".", "../admin", "a/../../admin", "..\\\\admin", "%2e%2e", ""]) {
    const out = await attempt(`shop.booksGetBook({ id: ${JSON.stringify(id)} })`);
    assert.equal((out as { code?: string }).code, "INVALID_ARGUMENT", `id ${JSON.stringify(id)}`);
  }
  assert.equal(seen.length, 0);
});

test("credentials and method overrides are not sandbox inputs", async () => {
  const { seen, attempt, api } = shop();
  const input = api.catalog.types.ShopBooksListBooksInput ?? "";
  assert.match(input, /X-Region/);
  for (const name of ["Authorization", "key", "_method", "X-HTTP-Method-Override"]) {
    assert.ok(!new RegExp(`^ +"?${name}"?\\?:`, "m").test(input), `${name} is declared`);
    const out = await attempt(`shop.booksListBooks({ ${JSON.stringify(name)}: "x" })`);
    assert.equal((out as { code?: string }).code, "INVALID_ARGUMENT", name);
  }
  const smuggled = await attempt(`shop.booksListBooks({ page: { _method: "DELETE" } })`);
  assert.equal((smuggled as { code?: string }).code, "INVALID_ARGUMENT", "through an exploded object");
  assert.equal(seen.length, 0);
});

test("the host's credentials are sent, win, and are redacted when echoed", async () => {
  const { seen, attempt } = shop(({ headers, url }) => Response.json({ saw: headers, query: url.search }), {
    headers: async () => ({ Authorization: "Bearer s3cret-token", "X-Region": "us" }),
    query: { key: "query-s3cret" },
  });
  const out = await attempt(`shop.booksListBooks({ "X-Region": "eu" })`);
  assert.equal(seen[0]?.headers.authorization, "Bearer s3cret-token");
  assert.equal(seen[0]?.headers["x-region"], "us");
  assert.equal(seen[0]?.url.searchParams.get("key"), "query-s3cret");
  assert.doesNotMatch(JSON.stringify(out), /s3cret/);
});

test("echoed credentials are redacted from errors too", async () => {
  const { attempt } = shop(() => new Response("bad token s3cret-token", { status: 401 }), {
    headers: { authorization: "Bearer s3cret-token" },
  });
  assert.deepEqual(await attempt("shop.booksListBooks()"), {
    code: "UNAUTHENTICATED",
    message: "bad token [redacted]",
  });
});

test("a failed fetch does not leak the URL's credential", async () => {
  const { attempt } = shop(
    ({ url }) => {
      throw new TypeError(`cannot connect to ${url}`);
    },
    { query: { key: "query-s3cret" } },
  );
  const out = await attempt("shop.booksListBooks()");
  assert.equal((out as { code?: string }).code, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(out), /s3cret/);
});

test("redirects are not followed, and large responses are refused", async () => {
  const redirect = shop(() => new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
  const moved = await redirect.attempt("shop.booksListBooks()");
  assert.equal(redirect.seen[0]?.init.redirect, "manual");
  assert.equal((moved as { code?: string }).code, "FAILED_PRECONDITION");

  const large = shop(() => new Response("x".repeat(64)), { maxResponseBytes: 16 });
  assert.equal(((await large.attempt("shop.booksListBooks()")) as { code?: string }).code, "RESOURCE_EXHAUSTED");
});

test("spec text cannot break out of the declarations", () => {
  const description = "*/ declare const owned: { run(): void }; /*";
  const paths = {
    "/x": { get: { operationId: "x", description, responses: { "200": { description: "ok" } } } },
  };
  const { catalog } = openApiConnector({ openapi: "3.1.0", info: {}, paths }, at);
  const declaration = catalog.methods[0]?.declaration ?? "";
  assert.ok(!declaration.includes("*/ declare"), declaration);
});

test("a spec that references itself in branches cannot hang startup", () => {
  const self = { $ref: "#/paths/~1x/get/responses/200/content/application~1json/schema" };
  const schema = { type: "object", properties: { a: self, b: self, c: self, d: self }, allOf: [self, self] };
  const get = { operationId: "x", responses: { "200": { content: { "application/json": { schema } } } } };
  const query = [{ name: "q", in: "query", schema: self }];
  const paths = { "/x": { get: { ...get, parameters: query } } };
  const started = Date.now();
  const { catalog } = openApiConnector({ openapi: "3.0.3", paths }, at);
  assert.equal(catalog.methods.length, 1);
  assert.ok(Date.now() - started < 5000);
});

test("a misconfiguration fails at startup", () => {
  assert.throws(() => openApiConnector(spec, { ...at, approval: { booksGetBok: true } }), /no method/);
  assert.throws(() => openApiConnector(spec, { ...at, exclude: ["nope"] }), /no method/);
  for (const namespace of ["codemode", "fetch", "constructor", "Shop", "a-b"]) {
    assert.throws(() => openApiConnector(spec, { ...at, namespace }), /sandbox global/);
  }
  assert.throws(() => openApiConnector(spec, { ...at, baseUrl: "https://u:p@shop.test" }), /credentials/);
  assert.throws(() => openApiConnector({ swagger: "2.0" }, at), /3\.0 and 3\.1/);
  const external = { $ref: "https://evil.test/item.json" };
  assert.throws(() => openApiConnector({ ...spec, paths: { "/x": external } }, at), /not a local reference/);
});
