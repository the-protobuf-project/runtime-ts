# @the-protobuf-project/codemode

[Code Mode](https://developers.cloudflare.com/agents/tools/codemode/) for
protobuf services: a model gets one tool, writes an async function against your
typed API, and a sandbox runs it. Calls that need a person pause for approval;
approval replays the code from a log; applied calls can be rolled back.

The connectors and catalog come from
[protoc-gen-codemode](https://github.com/the-protobuf-project/codemode); this
package runs them.

```sh
bun add @the-protobuf-project/codemode quickjs-emscripten
```

## Usage

### Run code

```ts
import { createCodemode } from "@the-protobuf-project/codemode";
import { QuickJSExecutor } from "@the-protobuf-project/codemode/quickjs";
import { httpTransport } from "@the-protobuf-project/network";
import { catalog, config, connectors, libraryV1 } from "./gen/index.ts";

const library = new libraryV1.LibraryServiceClient(httpTransport({ baseUrl: "https://library.example.com" }));
const runtime = createCodemode({
  catalog,
  config,
  connectors: connectors({ library }),
  executor: new QuickJSExecutor(),
});

const out = await runtime.execute({
  code: `async () => {
    const page = await library.listBooks({ parent: "shelves/poetry" });
    return page.books.map((b) => b.title);
  }`,
});
// { status: "completed", executionId, result: ["Leaves of Grass", "Odes"] }
```

### Approve, reject, roll back

```ts
const out = await runtime.execute({ code: `await library.archiveShelf({ name: "shelves/fiction" });` });
if (out.status === "paused") {
  const [call] = out.pending; // { seq, path: "library.archiveShelf", args, message? }
  const resumed = await runtime.approve({ executionId: out.executionId }); // replays, then runs the call
  // or: await runtime.reject({ executionId: out.executionId, seq: call.seq });
}

await runtime.rollback({ executionId: out.executionId }); // runs generated reverts, newest first
```

### Give it to a model

```ts
// MCP: one `code` tool (or `search` + `execute`), approvals through elicitation
import { createMcpServer } from "@the-protobuf-project/codemode/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
await createMcpServer(runtime, { name: "library" }).connect(new StdioServerTransport());

// Vercel AI SDK
import { codemodeTool } from "@the-protobuf-project/codemode/ai";
await generateText({ model, prompt, tools: { codemode: codemodeTool(runtime) } });

// Anything else: name, description, JSON Schema and execute
const tool = runtime.tool();
```

Without elicitation, a paused execution goes back to the model with
`codemode_approve` and `codemode_reject` tools, so the model could approve its
own calls. Turn them off when a person must decide, and say where they do:

```ts
createMcpServer(runtime, {
  approvalTools: false, // the model gets `code` and `codemode_status` only
  approvalHint: "Ask the user to approve at http://127.0.0.1:4791, then call codemode_status.",
});
// your approval page or app calls runtime.pending() and runtime.approve({ executionId })
```

### Keep executions across restarts

```ts
import { SqliteStore, durableObjectSql } from "@the-protobuf-project/codemode";
import { DatabaseSync } from "node:sqlite"; // Bun and Deno support node:sqlite too

const store = new SqliteStore(new DatabaseSync("codemode.db"));
// In a Durable Object: new SqliteStore(durableObjectSql(ctx.storage.sql))
createCodemode({ catalog, config, connectors, executor, store });
```

### Choose a sandbox

| Import                                      | Runs on                    | Isolation                                                       |
| ------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| `@the-protobuf-project/codemode/quickjs`    | Bun, Node, Deno, browsers  | QuickJS in WebAssembly; memory cap; interrupted at the deadline |
| `@the-protobuf-project/codemode/deno`       | hosts with a `deno` binary | a process with every permission denied; killed at the deadline  |
| `@the-protobuf-project/codemode/cloudflare` | Cloudflare Workers         | a Worker Loader isolate per pass; no outbound network           |
| `@the-protobuf-project/codemode/browser`    | browsers                   | a sandboxed iframe with a no-network CSP                        |

```ts
import { WorkerLoaderExecutor } from "@the-protobuf-project/codemode/cloudflare";
const executor = new WorkerLoaderExecutor({ loader: env.LOADER });
```

### Hooks, snippets and housekeeping

```ts
createCodemode({
  catalog,
  connectors,
  executor,
  hooks: {
    onPassEnd: (id, status) => metrics.count(`codemode.${status}`),
    disposeExecution: (id) => cleanup(id),
  },
});

await runtime.saveSnippet("count_poetry", { executionId, description: "Counts poetry books" });
await runtime.execute({ code: `return await codemode.run("count_poetry");` });

await runtime.expirePaused({ maxAgeMs: 86_400_000 }); // reject approvals older than a day
await runtime.pruneExecutions(50);
```

### What sandboxed code sees

```ts
declare const codemode: {
  search(query: string): Promise<{ results: { path: string; kind: "method" | "snippet"; score: number }[] }>;
  describe(target: string): Promise<{ types: string }>; // TypeScript for a namespace or method
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>; // recorded, so replays reuse it
  run(name: string, input?: unknown): Promise<unknown>; // a saved snippet
};
```

Plus one global per service, such as `library`, typed by the generated
`sandbox.d.ts`.

## API

<!-- api:start -->
<!-- Generated by tools/docgen.ts from the doc comments. Do not edit. -->

### `@the-protobuf-project/codemode`

| Export | Kind | Description |
| --- | --- | --- |
| `Description` | interface | TypeScript for one namespace, method or snippet. |
| `describe` | function | Returns TypeScript for a namespace, a "namespace.method" path, or a snippet. |
| `SearchResult` | interface | One search hit. |
| `SearchResults` | interface | Ranked search hits, capped at the limit. |
| `search` | function | Ranks methods and snippets for a keyword query. |
| `Catalog` | interface | Everything the sandbox exposes; generated as codemode/catalog.ts. |
| `CatalogMethod` | interface | One sandbox method, as the generator describes it. |
| `CatalogNamespace` | interface | One sandbox global. |
| `CatalogSnippet` | interface | A snippet shipped in the proto. |
| `CodemodeConfig` | interface | Runtime settings; generated as codemode/config.ts from codemode.yaml. |
| `ConnectorSpec` | interface | The generated description of a connector. |
| `connector` | function | Builds a connector, applying deployment options. |
| `UnaryMethodSpec` | interface | A typed unary method, before it is wrapped for protojson. |
| `unaryMethod` | function | Wraps a typed method so the sandbox can call it with protojson. |
| `CallContext` | interface | Context passed to every connector call. |
| `Connector` | interface | A namespace of methods the sandbox can call, e.g. |
| `ConnectorMethod` | interface | One sandbox method. |
| `ConnectorOptions` | interface | Deployment-time adjustments to a generated connector. |
| `Replay` | type | What a replayed call does: return its logged result, or run again. |
| `normalizeCode` | function | Turns what a model wrote into one async function expression: strips a Markdown fence, strips TypeScript types, and wraps a bare statement list as `async () => { ... |
| `ExecuteRequest` | interface | One sandbox pass. |
| `ExecuteResult` | type | What the sandbox returned: the script's result envelope, or why it failed. |
| `Executor` | interface | Runs untrusted code in isolation. |
| `HostCall` | type | The one way out of the sandbox. |
| `CodemodeOptions` | interface | Options for createCodemode(). |
| `createCodemode` | function | Creates the Code Mode runtime. |
| `CodemodeRuntime` | class | The durable Code Mode runtime: runs model code in the sandbox, pauses for approval, replays on resume, rolls back, and keeps snippets. |
| `SaveSnippetOptions` | interface | Options for saving a snippet. |
| `CodemodeTool` | interface | A framework-neutral tool: adapt it to MCP, the AI SDK or anything else. |
| `TruncateOptions` | interface | A size budget. |
| `truncateResult` | function | Returns value unchanged when its JSON fits the budget, or the truncated JSON text when it does not. |
| `truncateText` | function | Cuts text to the budget, marking where it was cut. |
| `CodeInput` | interface | The codemode tool's input. |
| `CodeOutput` | type | The codemode tool's output. |
| `Execution` | interface | A model's code and everything that happened when it ran. |
| `ExecutionStatus` | type | Where an execution is in its life. |
| `Hooks` | interface | Lifecycle hooks. |
| `LogEntry` | interface | One recorded connector call or codemode.step(), by sequence number. |
| `PendingAction` | interface | A call waiting for a person's approval. |
| `RollbackResult` | interface | What a rollback did. |
| `SerializedError` | interface | An error as it is stored and returned to sandboxed code. |
| `Snippet` | interface | Reusable code, saved from an execution or shipped in the proto. |
| `TerminalStatus` | type | A terminal status: the execution will not run again. |
| `DEFAULT_MAX_EXECUTIONS` | const | The default number of finished executions kept. |
| `DEFAULT_PAUSED_TTL_MS` | const | The default time a paused execution waits before it expires: 24 hours. |
| `MAX_DURABLE_VALUE_BYTES` | const | The largest value, as JSON characters, the runtime records for replay. |
| `MemoryStore` | class | Keeps state in memory. |
| `DurableObjectSql` | interface | A Durable Object's SqlStorage, as the store sees it. |
| `durableObjectSql` | function | Adapts a Durable Object's ctx.storage.sql to SqliteDatabase. |
| `SqliteDatabase` | interface | The slice of a SQLite driver the store needs. |
| `SqliteStore` | class | Keeps state in SQLite, so paused executions survive restarts. |
| `Store` | interface | Durable state: executions, with their call logs and pending approvals, and snippets. |

### `@the-protobuf-project/codemode/quickjs`

| Export | Kind | Description |
| --- | --- | --- |
| `QuickJSExecutorOptions` | interface | Options for the QuickJS executor. |
| `QuickJSExecutor` | class | Runs each pass in a fresh QuickJS interpreter compiled to WebAssembly. |

### `@the-protobuf-project/codemode/deno`

| Export | Kind | Description |
| --- | --- | --- |
| `DenoExecutorOptions` | interface | Options for the Deno executor. |
| `DenoExecutor` | class | Runs each pass in a separate Deno process with no permissions: no network, filesystem, environment or subprocesses. |

### `@the-protobuf-project/codemode/cloudflare`

| Export | Kind | Description |
| --- | --- | --- |
| `CloudflareConnectorTool` | interface | The tool shape @cloudflare/codemode's CodemodeConnector.tools() returns. |
| `cloudflareTools` | function | Converts a generated connector to @cloudflare/codemode tools, for hosts that run Cloudflare's durable runtime instead of this package's: |
| `DurableObjectSql` | interface | A Durable Object's SqlStorage, as the store sees it. |
| `durableObjectSql` | function | Adapts a Durable Object's ctx.storage.sql to SqliteDatabase. |
| `SqliteStore` | class | Keeps state in SQLite, so paused executions survive restarts. |
| `WorkerLoader` | interface | A worker_loaders binding: either API generation fits. |
| `WorkerLoaderExecutor` | class | Runs each pass in a fresh Worker isolate created by a Worker Loader, with outbound network blocked. |
| `WorkerLoaderExecutorOptions` | interface | Options for the Worker Loader executor. |

### `@the-protobuf-project/codemode/browser`

| Export | Kind | Description |
| --- | --- | --- |
| `IframeExecutorOptions` | interface | Options for the iframe executor. |
| `IframeExecutor` | class | Runs each pass in a hidden iframe with sandbox="allow-scripts" and a CSP that blocks network access. |

### `@the-protobuf-project/codemode/mcp`

| Export | Kind | Description |
| --- | --- | --- |
| `McpServerOptions` | interface | Options for the Code Mode MCP server. |
| `createMcpServer` | function | Publishes a Code Mode runtime as an MCP server. |

### `@the-protobuf-project/codemode/ai`

| Export | Kind | Description |
| --- | --- | --- |
| `codemodeTool` | function | The codemode tool for the Vercel AI SDK. |

<!-- api:end -->

A module of [runtime-ts](https://github.com/the-protobuf-project/runtime-ts). Licensed under Apache 2.0.
