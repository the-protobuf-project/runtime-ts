// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { normalizeCode, type Executor, type HostCall } from "../src/index.ts";
import { DenoExecutor } from "../src/deno/index.ts";
import { buildScript } from "../src/executor/prelude.ts";
import { QuickJSExecutor } from "../src/quickjs/index.ts";

const echoHost: HostCall = async (op, payload) => {
  if (op === "call") return JSON.stringify({ value: JSON.parse(payload) });
  return JSON.stringify({ value: null });
};

async function run(executor: Executor, code: string, options: { host?: HostCall; timeoutMs?: number; signal?: AbortSignal } = {}) {
  const script = buildScript({ namespaces: { api: ["echo"] }, snippets: { twice: "async (n) => n * 2" } }, normalizeCode(code));
  const res = await executor.execute({
    script,
    host: options.host ?? echoHost,
    timeoutMs: options.timeoutMs ?? 5000,
    memoryMb: 32,
    signal: options.signal ?? new AbortController().signal,
  });
  return res.ok ? (JSON.parse(res.json) as { ok: boolean; value?: unknown; error?: { message: string; code?: string } }) : res;
}

const deno = process.env["CODEMODE_DENO"] ?? "deno";
const denoAvailable = spawnSync(deno, ["--version"]).status === 0;
const executors: [string, () => Executor, boolean][] = [
  ["QuickJS", () => new QuickJSExecutor(), false],
  ["Deno", () => new DenoExecutor({ command: deno }), !denoAvailable],
];

for (const [name, make, skip] of executors) {
  test(`${name}: calls cross the bridge and results come back`, { skip }, async () => {
    const out = await run(make(), "async () => { const r = await api.echo({ n: 1 }); return [r.path, r.args.n]; }");
    assert.deepEqual(out, { ok: true, value: ["api.echo", 1] });
  });

  test(`${name}: the sandbox has no network, modules or process`, { skip }, async () => {
    const out = await run(make(), 'async () => [typeof fetch, typeof require, typeof process, typeof Deno === "undefined" ? "undefined" : typeof Deno.readTextFile]');
    if ("value" in out && Array.isArray(out.value) && out.value[3] === "function") {
      // Deno exposes its API, but without permissions every call is denied.
      const denied = await run(make(), `async () => { try { await Deno.readTextFile("/etc/hosts"); return "read"; } catch (e) { return e.name; } }`);
      assert.deepEqual(denied, { ok: true, value: "NotCapable" });
      const net = await run(make(), `async () => { try { await fetch("https://example.com"); return "fetched"; } catch (e) { return e.name; } }`);
      assert.deepEqual(net, { ok: true, value: "NotCapable" });
      return;
    }
    assert.deepEqual(out, { ok: true, value: ["undefined", "undefined", "undefined", "undefined"] });
  });

  test(`${name}: thrown errors keep their code`, { skip }, async () => {
    const host: HostCall = async () => JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } });
    const out = await run(make(), "async () => { try { await api.echo({}); } catch (e) { return [e.name, e.code, e.message]; } }", { host });
    assert.deepEqual(out, { ok: true, value: ["CodemodeError", "NOT_FOUND", "gone"] });
  });

  test(`${name}: unknown methods fail with a hint`, { skip }, async () => {
    const out = await run(make(), "async () => api.missing({})");
    assert.equal("error" in out && typeof out.error === "object" && out.error.code, "NOT_FOUND");
  });

  test(`${name}: snippets run from the prelude`, { skip }, async () => {
    assert.deepEqual(await run(make(), "async () => codemode.run('twice', 21)"), { ok: true, value: 42 });
  });

  test(`${name}: a busy loop stops at the deadline`, { skip }, async () => {
    const out = await run(make(), "async () => { while (true) {} }", { timeoutMs: 300 });
    assert.deepEqual(out, { ok: false, error: "timed out after 300 ms" });
  });

  test(`${name}: aborting stops a pass waiting on the host`, { skip }, async () => {
    const controller = new AbortController();
    const host: HostCall = () => (controller.abort(), new Promise(() => {}));
    const out = await run(make(), "async () => api.echo({})", { host, signal: controller.signal });
    assert.deepEqual(out, { ok: false, error: "aborted", aborted: true });
  });
}

test("normalizeCode accepts functions, bodies, fences and TypeScript", () => {
  assert.equal(normalizeCode("async () => 1;"), "async () => 1");
  assert.equal(normalizeCode("return 1"), "async () => {\nreturn 1\n}");
  assert.equal(normalizeCode("```js\nasync () => 2\n```"), "async () => 2");
  assert.match(normalizeCode("async (): Promise<number> => { const x: number = 1; return x; }"), /const x = 1/);
  assert.match(normalizeCode("const n: number = await api.count({});\nreturn n;"), /const n = await/);
  assert.throws(() => normalizeCode("   "), { code: "INVALID_ARGUMENT" });
});
