// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StructCodec } from "@the-protobuf-project/protobuf";
import { type Catalog, CodemodeRuntime, connector, unaryMethod } from "../src/index.ts";
import { createMcpServer, type McpServerOptions } from "../src/mcp/index.ts";
import { QuickJSExecutor } from "../src/quickjs/index.ts";

const catalog: Catalog = {
  prelude: "",
  types: {},
  namespaces: [{ name: "kv", service: "kv.v1.Kv", instructions: "", declaration: "", methods: ["kv.wipe"] }],
  methods: [
    {
      path: "kv.wipe",
      namespace: "kv",
      name: "wipe",
      rpc: "kv.v1.Kv.Wipe",
      description: "wipe everything",
      requiresApproval: true,
      replay: "log",
      readOnly: false,
      declaration: "  wipe(input: object): Promise<object>;\n",
      types: [],
      examples: [],
    },
  ],
  snippets: [],
};

async function connect(options: McpServerOptions) {
  const wipe = unaryMethod({
    name: "wipe",
    input: StructCodec,
    output: StructCodec,
    requiresApproval: true,
    replay: "log",
    call: async () => ({}) as never,
  });
  const runtime = new CodemodeRuntime({
    catalog,
    connectors: [connector({ namespace: "kv", methods: [wipe] })],
    executor: new QuickJSExecutor(),
  });
  const server = createMcpServer(runtime, options);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, runtime };
}

const run = { name: "code", arguments: { code: `await kv.wipe({}); return "wiped";` } };

test("with approvalTools false the model cannot approve its own calls", async () => {
  const { client, runtime } = await connect({ approvalTools: false, approvalHint: "Approve at http://localhost/" });
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["code", "codemode_status"],
  );
  const paused = (await client.callTool(run)).structuredContent as {
    status: string;
    executionId: string;
    message: string;
  };
  assert.equal(paused.status, "paused");
  assert.equal(paused.message, "Approve at http://localhost/");
  const tried = await client.callTool({ name: "codemode_approve", arguments: { executionId: paused.executionId } });
  assert.equal(tried.isError, true);

  await runtime.approve({ executionId: paused.executionId });
  const done = await client.callTool({ name: "codemode_status", arguments: { executionId: paused.executionId } });
  assert.deepEqual(done.structuredContent, {
    status: "completed",
    executionId: paused.executionId,
    result: "wiped",
    approved: [{ seq: 1, path: "kv.wipe", args: {} }],
  });
});

test("approval tools stay listed by default", async () => {
  const { client } = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["code", "codemode_status", "codemode_approve", "codemode_reject"],
  );
});

test("elicitation asks about each parallel call and approves only that one", async () => {
  const { runtime } = await connect({});
  const server = createMcpServer(runtime, {});
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: { elicitation: { form: {} } } });
  const asked: string[] = [];
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    asked.push(req.params.message);
    return { action: "accept", content: { approve: true } };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const out = await client.callTool({
    name: "code",
    arguments: { code: `await Promise.all([kv.wipe({ n: 1 }), kv.wipe({ n: 2 })]); return "both";` },
  });
  assert.equal((out.structuredContent as { status: string }).status, "completed");
  assert.equal(asked.length, 2, "one prompt per call");
});

test("approve with seq approves one of two parallel calls; the other pauses again", async () => {
  const { runtime } = await connect({});
  const code = `await Promise.all([kv.wipe({ n: 1 }), kv.wipe({ n: 2 })]); return "both";`;
  const first = await runtime.execute({ code });
  assert.equal(first.status, "paused");
  if (first.status !== "paused") return;
  assert.equal(first.pending.length, 2);
  const [one, two] = first.pending.map((p) => p.seq);

  const second = await runtime.approve({ executionId: first.executionId, seq: one ?? 0 });
  assert.equal(second.status, "paused");
  if (second.status !== "paused") return;
  assert.deepEqual(
    second.pending.map((p) => p.seq),
    [two],
  );
  await assert.rejects(runtime.approve({ executionId: first.executionId, seq: 99 }), /not pending/);
  const done = await runtime.approve({ executionId: first.executionId, seq: two ?? 0 });
  assert.equal(done.status, "completed");
});
