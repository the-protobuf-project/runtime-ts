# runtime-ts

[![CI](https://github.com/the-protobuf-project/runtime-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/the-protobuf-project/runtime-ts/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

**The TypeScript runtime underneath code generated from your `.proto` files.**

The protobuf project's plugins turn a proto service into typed clients, servers
and agent tools. What they generate is thin: types, codecs and descriptors. The
work happens here. It is the TypeScript counterpart of
[runtime-go](https://github.com/the-protobuf-project/runtime-go), and every
module is usable by hand as well.

It runs on Node 22.18+, Bun, Deno and Cloudflare Workers, with no build step on
your side: the package ships compiled JavaScript with types.

```mermaid
flowchart LR
    proto[".proto"] --> plugins["protoc-gen-* plugins"]
    plugins --> gen["generated TypeScript"]
    gen --> rt["@the-protobuf-project/runtime"]
    rt --> out["HTTP and Connect services,<br/>Code Mode sandboxes, MCP"]
```

## Modules

| Import | What it does | Generated against it by |
| --- | --- | --- |
| [`/protobuf`](src/protobuf) | Binary wire format, protojson, well-known types, enums, resource names, the `Any` registry | every TypeScript plugin |
| [`/network`](src/network) | `google.api.http` transcoding and Connect clients, a Connect server handler, the `Transport` interface | every TypeScript plugin |
| [`/errors`](src/errors) | `CodemodeError` with gRPC codes, mapping from HTTP and Connect | |
| [`/codemode`](src/codemode) | The Code Mode runtime: executions, approvals, replay, rollback, snippets, search, stores | [protoc-gen-codemode](https://github.com/the-protobuf-project/codemode) |
| `/codemode/quickjs` | Sandbox: QuickJS in WebAssembly (Node, Bun, Deno, browsers) | |
| `/codemode/deno` | Sandbox: a Deno process with every permission denied | |
| `/codemode/cloudflare` | Sandbox: a Worker Loader isolate; Durable Object storage | |
| `/codemode/browser` | Sandbox: a sandboxed iframe | |
| `/codemode/mcp` | Serve a Code Mode runtime as an MCP server | |
| `/codemode/ai` | The Code Mode tool for the Vercel AI SDK | |

The sandboxes and surfaces are separate entry points so their dependencies
(`quickjs-emscripten`, `@modelcontextprotocol/sdk`, `ai`) stay optional: install
the ones you use.

## Install

```sh
npm install @the-protobuf-project/runtime
npm install quickjs-emscripten            # for /codemode/quickjs
npm install @modelcontextprotocol/sdk     # for /codemode/mcp
```

Until the first release, install from GitHub:
`npm install github:the-protobuf-project/runtime-ts`.

## Example

```ts
import { createCodemode } from "@the-protobuf-project/runtime/codemode";
import { QuickJSExecutor } from "@the-protobuf-project/runtime/codemode/quickjs";
import { httpTransport } from "@the-protobuf-project/runtime/network";
import { catalog, config, connectors, libraryV1 } from "./gen/index.ts";

const client = new libraryV1.LibraryServiceClient(httpTransport({ baseUrl: "https://library.example.com" }));
const runtime = createCodemode({ catalog, config, connectors: connectors({ library: client }), executor: new QuickJSExecutor() });

await runtime.execute({ code: `async () => (await library.listBooks({ parent: "shelves/poetry" })).books.length` });
```

## Development

```sh
npm install
npm run typecheck
npm test               # Node
npm run test:bun
npm run test:deno      # set CODEMODE_DENO to a deno binary to run the Deno sandbox tests elsewhere
npm run lint:lines     # hand-written files stay under 200 lines
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Copyright 2026 The Protobuf Project authors.
