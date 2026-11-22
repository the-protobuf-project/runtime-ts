// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { CodemodeRuntime, connector, unaryMethod, type Catalog, type CodemodeConfig, type Hooks } from "../../src/codemode/index.ts";
import { StructCodec } from "../../src/protobuf/index.ts";
import { QuickJSExecutor } from "../../src/codemode/quickjs/index.ts";

const catalog: Catalog = {
  prelude: "",
  types: {},
  namespaces: [{ name: "kv", service: "kv.v1.Kv", instructions: "A key-value store.", declaration: "", methods: ["kv.get", "kv.put", "kv.wipe"] }],
  methods: ["get", "put", "wipe"].map((name) => ({
    path: `kv.${name}`, namespace: "kv", name, rpc: `kv.v1.Kv.${name}`, description: `${name} a key`,
    requiresApproval: name === "wipe", replay: name === "get" ? "reexecute" : "log", readOnly: name === "get",
    declaration: `  /** ${name} */\n  ${name}(input: object): Promise<object>;\n`, types: [], examples: [],
  })),
  snippets: [],
};

function setup(config: CodemodeConfig = {}, options: { approval?: Record<string, boolean>; exclude?: string[]; hooks?: Hooks } = {}) {
  const data = new Map<string, unknown>();
  const method = (name: string, requiresApproval: boolean, fn: (r: Record<string, unknown>) => unknown) =>
    unaryMethod({ name, input: StructCodec, output: StructCodec, requiresApproval, replay: "log", call: async (r) => fn(r) as never });
  const kv = connector({
    namespace: "kv",
    methods: [
      method("get", false, (r) => ({ value: data.get(String(r["key"])) ?? null })),
      method("put", false, (r) => (data.set(String(r["key"]), r["value"]), {})),
      method("wipe", true, () => (data.clear(), {})),
    ],
  }, options);
  const runtime = new CodemodeRuntime({
    catalog, connectors: [kv], executor: new QuickJSExecutor(), config,
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });
  return { runtime, data };
}

test("connector options override approval and hide methods", async () => {
  const { runtime } = setup({}, { approval: { put: true, wipe: false }, exclude: ["get"] });
  const out = await runtime.execute({ code: `await kv.put({ key: "a", value: 1 }); return "x";` });
  assert.equal(out.status, "paused");
  const described = await runtime.describe("kv");
  assert.doesNotMatch(described.types, /get\(/);
  assert.match(described.types, /put\(input: object\)/);
  const hidden = await runtime.execute({ code: `try { await kv.get({ key: "a" }); } catch (e) { return e.code; }` });
  assert.deepEqual(hidden.status === "completed" && hidden.result, "NOT_FOUND");
});

test("hooks see every pass end and one disposal", async () => {
  const seen: string[] = [];
  const { runtime } = setup({}, { hooks: { onPassEnd: (_, s) => void seen.push(`pass:${s}`), disposeExecution: (_, s) => void seen.push(`dispose:${s}`) } });
  const out = await runtime.execute({ code: `await kv.wipe({}); return 1;` });
  await runtime.approve({ executionId: out.executionId });
  assert.deepEqual(seen, ["pass:paused", "pass:completed", "dispose:completed"]);
});

test("expirePaused rejects stale approvals; prune keeps the newest finished runs", async () => {
  const { runtime } = setup({ runtime: { maxExecutions: 2 } });
  const paused = await runtime.execute({ code: `await kv.wipe({});` });
  for (let i = 0; i < 3; i++) await runtime.execute({ code: `return ${i};` });
  assert.equal((await runtime.executions(10)).filter((e) => e.status === "completed").length, 2);
  assert.deepEqual(await runtime.expirePaused({ maxAgeMs: 0 }), [paused.executionId]);
  assert.equal((await runtime.getExecution(paused.executionId))?.status, "rejected");
});

test("oversized results are refused before they are recorded", async () => {
  const { runtime } = setup({ runtime: { maxValueBytes: 50 } });
  const out = await runtime.execute({ code: `try { await kv.put({ key: "k", value: "${"x".repeat(100)}" }); } catch (e) { return e.code; }` });
  assert.deepEqual(out.status === "completed" && out.result, "RESOURCE_EXHAUSTED");
});

test("large results are truncated for the model", async () => {
  const { runtime } = setup({ runtime: { resultBudgetTokens: 10 } });
  const out = await runtime.execute({ code: `return "y".repeat(500);` });
  assert.match(String(out.status === "completed" && out.result), /--- TRUNCATED ---$/);
});

test("fetch is absent by default and allowlisted when configured", async () => {
  const closed = setup();
  const none = await closed.runtime.execute({ code: `return typeof fetch;` });
  assert.deepEqual(none.status === "completed" && none.result, "undefined");

  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (calls++, new Response('{"ok":1}', { status: 200 }))) as typeof fetch;
  try {
    const open = setup({ executor: { outbound: "allowlist", allow: ["*.example.com"] } });
    const code = `async () => {
      let denied;
      try { await fetch("https://evil.test/x"); } catch (e) { denied = e.code; }
      const r = await fetch("https://api.example.com/v1");
      await kv.wipe({});
      return [denied, r.status, (await r.json()).ok];
    }`;
    const out = await open.runtime.execute({ code });
    assert.equal(out.status, "paused", JSON.stringify(out));
    const done = await open.runtime.approve({ executionId: out.executionId });
    assert.deepEqual(done.status === "completed" && done.result, ["PERMISSION_DENIED", 200, 1]);
    assert.equal(calls, 1, "the replay reused the recorded response");
  } finally {
    globalThis.fetch = real;
  }
});
