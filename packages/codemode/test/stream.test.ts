// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { StringValueCodec } from "@the-protobuf-project/protobuf";
import {
  bidiStreamMethod,
  type Catalog,
  type CatalogMethod,
  CodemodeRuntime,
  type CodeOutput,
  clientStreamMethod,
  connector,
  serverStreamMethod,
} from "../src/index.ts";
import { QuickJSExecutor } from "../src/quickjs/index.ts";

type Text = string | null;
const codecs = { input: StringValueCodec, output: StringValueCodec };

function entry(name: string, streaming: CatalogMethod["streaming"], requiresApproval = false): CatalogMethod {
  return {
    path: `s.${name}`,
    namespace: "s",
    name,
    rpc: `s.v1.S.${name}`,
    description: name,
    requiresApproval,
    replay: "log",
    readOnly: !requiresApproval,
    declaration: `  ${name}(input: unknown, options?: object): Promise<unknown>;\n`,
    types: [],
    examples: [],
    ...(streaming ? { streaming } : {}),
  };
}

/** A runtime over streaming methods; opened counts how often a stream was opened. */
function setup() {
  const opened: string[] = [];
  const never = new Promise<never>(() => undefined);
  const methods = [
    serverStreamMethod<Text, Text>({
      name: "count",
      ...codecs,
      requiresApproval: false,
      async *call(upTo) {
        opened.push("count");
        for (let i = 1; i <= Number(upTo); i++) yield String(i);
      },
    }),
    serverStreamMethod<Text, Text>({
      name: "endless",
      ...codecs,
      requiresApproval: false,
      async *call() {
        opened.push("endless");
        yield "first";
        await never; // ignores its signal: the deadline still ends the call
      },
    }),
    clientStreamMethod<Text, Text>({
      name: "join",
      ...codecs,
      requiresApproval: false,
      async call(requests) {
        const parts: Text[] = [];
        for await (const r of requests) parts.push(r);
        return parts.join("+");
      },
    }),
    bidiStreamMethod<Text, Text>({
      name: "shout",
      ...codecs,
      requiresApproval: true,
      async *call(requests) {
        opened.push("shout");
        for await (const r of requests) yield String(r).toUpperCase();
      },
    }),
  ];
  const catalog: Catalog = {
    prelude: "",
    types: {},
    namespaces: [{ name: "s", service: "s.v1.S", instructions: "", declaration: "", methods: [] }],
    methods: [
      entry("count", "server"),
      entry("endless", "server"),
      entry("join", "client"),
      entry("shout", "bidi", true),
    ],
    snippets: [],
  };
  const runtime = new CodemodeRuntime({
    catalog,
    connectors: [connector({ namespace: "s", methods })],
    executor: new QuickJSExecutor(),
  });
  return { runtime, opened };
}

function completed(out: CodeOutput): unknown {
  assert.equal(out.status, "completed", JSON.stringify(out));
  return out.status === "completed" ? out.result : undefined;
}

test("a server stream returns every reply once it ends", async () => {
  const { runtime } = setup();
  const out = await runtime.execute({ code: `async () => s.count("3")` });
  assert.deepEqual(completed(out), { messages: ["1", "2", "3"], complete: true });
});

test("limit cuts a stream short and says so", async () => {
  const { runtime } = setup();
  const out = await runtime.execute({ code: `async () => s.count("50", { limit: 2 })` });
  assert.deepEqual(completed(out), { messages: ["1", "2"], complete: false });
});

test("timeoutMs ends a stream that never finishes, even one that ignores cancellation", async () => {
  const { runtime } = setup();
  const started = Date.now();
  const out = await runtime.execute({ code: `async () => s.endless("x", { timeoutMs: 200 })` });
  assert.deepEqual(completed(out), { messages: ["first"], complete: false });
  assert.ok(Date.now() - started < 3000);
});

test("bad bounds are refused before the stream opens", async () => {
  const { runtime, opened } = setup();
  const out = await runtime.execute({
    code: `async () => { try { await s.count("3", { limit: 5000 }); } catch (e) { return e.code; } }`,
  });
  assert.equal(completed(out), "INVALID_ARGUMENT");
  assert.deepEqual(opened, []);
});

test("a client stream sends every request and returns the reply", async () => {
  const { runtime } = setup();
  assert.equal(completed(await runtime.execute({ code: `async () => s.join(["a", "b", "c"])` })), "a+b+c");
  const out = await runtime.execute({
    code: `async () => { try { await s.join("a"); } catch (e) { return e.code; } }`,
  });
  assert.equal(completed(out), "INVALID_ARGUMENT");
});

test("a bidi stream waits for approval, then runs once and replays from the log", async () => {
  const { runtime, opened } = setup();
  const paused = await runtime.execute({
    code: `async () => {
      const first = await s.count("2");
      const loud = await s.shout(["a", "b"], { limit: 10 });
      return [first.messages, loud];
    }`,
  });
  assert.equal(paused.status, "paused");
  if (paused.status !== "paused") return;
  assert.deepEqual(paused.pending[0]?.options, { limit: 10 });
  assert.deepEqual(opened, ["count"], "nothing streamed before approval");
  const done = await runtime.approve({ executionId: paused.executionId, seq: paused.pending[0]?.seq ?? 0 });
  assert.deepEqual(completed(done), [["1", "2"], { messages: ["A", "B"], complete: true }]);
  assert.deepEqual(opened, ["count", "shout"], "the logged stream was not opened again on resume");
});

test("the tool explains streaming only when a catalog has a stream", () => {
  const { runtime } = setup();
  assert.match(runtime.tool().description, /complete is false when it was\s+cut short/);
});
