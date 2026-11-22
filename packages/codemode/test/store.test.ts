// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Execution, MemoryStore, type SqliteDatabase, SqliteStore, type Store } from "../src/index.ts";

function execution(id: string, createdAt: number, status: Execution["status"] = "completed"): Execution {
  return {
    id,
    code: "async () => 1",
    status,
    createdAt,
    updatedAt: createdAt,
    passes: 1,
    log: [],
    approved: [],
    pending: [],
    logs: [],
  };
}

async function sqlite(): Promise<SqliteDatabase | undefined> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(":memory:") as unknown as SqliteDatabase;
  } catch {
    try {
      const { Database } = await import("bun:sqlite" as string);
      return new Database(":memory:") as SqliteDatabase;
    } catch {
      return undefined;
    }
  }
}

const db = await sqlite();
const stores: [string, () => Store, boolean][] = [
  ["MemoryStore", () => new MemoryStore(), false],
  ["SqliteStore", () => new SqliteStore(db as SqliteDatabase), db === undefined],
];

for (const [name, make, skip] of stores) {
  test(`${name}: executions are stored, listed newest first, and deleted`, { skip }, async () => {
    const store = make();
    await store.putExecution(execution("a", 1));
    await store.putExecution(execution("b", 2));
    const updated = { ...execution("a", 1, "rolled_back"), result: { n: 1 } };
    await store.putExecution(updated);
    assert.deepEqual(await store.getExecution("a"), updated);
    assert.deepEqual(
      (await store.listExecutions()).map((e) => e.id),
      ["b", "a"],
    );
    assert.deepEqual(
      (await store.listExecutions(1)).map((e) => e.id),
      ["b"],
    );
    assert.equal(await store.deleteExecution("a"), true);
    assert.equal(await store.deleteExecution("a"), false);
    assert.equal(await store.getExecution("a"), undefined);
  });

  test(`${name}: snippets are stored by name`, { skip }, async () => {
    const store = make();
    await store.putSnippet({ name: "z", code: "async () => 1", source: "saved", createdAt: 1 });
    await store.putSnippet({ name: "a", code: "async () => 2", source: "proto", createdAt: 1 });
    assert.deepEqual(
      (await store.listSnippets()).map((s) => s.name),
      ["a", "z"],
    );
    assert.equal((await store.getSnippet("z"))?.code, "async () => 1");
    assert.equal(await store.deleteSnippet("z"), true);
    assert.equal(await store.getSnippet("z"), undefined);
  });
}
