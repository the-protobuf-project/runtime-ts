// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { createCodemode } from "../src/index.ts";
import { type OpenApiConnectorOptions, openApiConnector } from "../src/openapi/index.ts";
import { QuickJSExecutor } from "../src/quickjs/index.ts";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const id = { name: "id", in: "path", required: true, schema: { type: "string" } };

/** A small bookshop API, with the parts of OpenAPI the connector has to get right. */
export const spec = {
  openapi: "3.0.3",
  info: { title: "Bookshop", description: "Sells books." },
  servers: [{ url: "https://evil.test" }],
  components: {
    securitySchemes: { key: { type: "apiKey", in: "query", name: "key" } },
    schemas: {
      Book: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string", readOnly: true },
          title: { type: "string" },
          state: { enum: ["IN_STOCK", "SOLD"] },
          parent: { allOf: [{ $ref: "#/components/schemas/Book" }], description: "The series it is in." },
        },
      },
    },
  },
  paths: {
    "/books": {
      get: {
        operationId: "Books_ListBooks",
        parameters: [
          { name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
          { name: "ids", in: "query", explode: false, schema: { type: "array", items: { type: "integer" } } },
          { name: "where", in: "query", style: "deepObject", schema: { type: "object" } },
          { name: "page", in: "query", schema: { type: "object", properties: { size: { type: "integer" } } } },
          { name: "key", in: "query", schema: { type: "string" } },
          { name: "_method", in: "query", schema: { type: "string" } },
          { name: "Authorization", in: "header", schema: { type: "string" } },
          { name: "X-HTTP-Method-Override", in: "header", schema: { type: "string" } },
          { name: "X-Region", in: "header", schema: { type: "string" } },
        ],
        responses: { "200": json({ type: "array", items: { $ref: "#/components/schemas/Book" } }) },
      },
      post: {
        operationId: "Books_CreateBook",
        summary: "Adds a book.",
        requestBody: { required: true, ...json({ $ref: "#/components/schemas/Book" }) },
        responses: { "201": json({ $ref: "#/components/schemas/Book" }) },
      },
    },
    "/books/{id}": {
      parameters: [id],
      get: { operationId: "Books_GetBook", responses: { "200": json({ $ref: "#/components/schemas/Book" }) } },
      delete: { operationId: "Books_DeleteBook", responses: { "204": { description: "Gone." } } },
    },
    "/books:search": {
      post: { operationId: "Books_SearchBooks", responses: { "200": json({ type: "object" }) } },
    },
    "/cover": {
      put: {
        operationId: "Books_PutCover",
        requestBody: { content: { "multipart/form-data": {} } },
        responses: {},
      },
    },
  },
};

/** One request the fake server saw. */
export interface Seen {
  url: URL;
  init: RequestInit;
  headers: Record<string, string>;
}

/** A bookshop connector and runtime over a fake fetch. */
export function shop(
  reply: (seen: Seen) => Response = () => Response.json({}),
  options: Partial<OpenApiConnectorOptions> = {},
) {
  const seen: Seen[] = [];
  const api = openApiConnector(spec, {
    namespace: "shop",
    baseUrl: "https://shop.test/api/",
    fetch: async (url, init) => {
      const request = { url: new URL(url), init, headers: init.headers as Record<string, string> };
      seen.push(request);
      return reply(request);
    },
    ...options,
  });
  const runtime = createCodemode({
    catalog: api.catalog,
    connectors: [api.connector],
    executor: new QuickJSExecutor(),
  });
  /** Runs code that returns the gRPC code of what it throws, or its value. */
  const attempt = async (call: string) => {
    const out = await runtime.execute({
      code: `async () => { try { return await ${call}; } catch (e) { return { code: e.code, message: e.message }; } }`,
    });
    if (out.status !== "completed") throw new Error(JSON.stringify(out));
    return out.result;
  };
  return { api, runtime, seen, attempt };
}
