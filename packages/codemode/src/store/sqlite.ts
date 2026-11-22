// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Execution, Snippet } from "../runtime/types.ts";
import type { Store } from "./types.ts";

/** A row as SQLite drivers return it. */
export type Row = Record<string, unknown>;

/**
 * The slice of a SQLite driver the store needs. bun:sqlite's Database and
 * node:sqlite's DatabaseSync (also in Deno) fit as they are; use
 * durableObjectSql() for a Durable Object's storage.sql.
 */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

const schema = `
CREATE TABLE IF NOT EXISTS codemode_executions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS codemode_executions_created ON codemode_executions (created_at);
CREATE TABLE IF NOT EXISTS codemode_snippets (
  name TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
`;

/** Keeps state in SQLite, so paused executions survive restarts. */
export class SqliteStore implements Store {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    db.exec(schema);
  }

  async getExecution(id: string): Promise<Execution | undefined> {
    const row = this.db.prepare("SELECT body FROM codemode_executions WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(String(row.body)) as Execution) : undefined;
  }

  async putExecution(e: Execution): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO codemode_executions (id, created_at, status, body) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body",
      )
      .run(e.id, e.createdAt, e.status, JSON.stringify(e));
  }

  async deleteExecution(id: string): Promise<boolean> {
    const existed = this.db.prepare("SELECT 1 AS x FROM codemode_executions WHERE id = ?").get(id) !== undefined;
    this.db.prepare("DELETE FROM codemode_executions WHERE id = ?").run(id);
    return existed;
  }

  async listExecutions(limit = -1): Promise<Execution[]> {
    const rows = this.db
      .prepare("SELECT body FROM codemode_executions ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(Number.isFinite(limit) ? limit : -1) as Row[];
    return rows.map((r) => JSON.parse(String(r.body)) as Execution);
  }

  async getSnippet(name: string): Promise<Snippet | undefined> {
    const row = this.db.prepare("SELECT body FROM codemode_snippets WHERE name = ?").get(name) as Row | undefined;
    return row ? (JSON.parse(String(row.body)) as Snippet) : undefined;
  }

  async putSnippet(s: Snippet): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO codemode_snippets (name, body) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body",
      )
      .run(s.name, JSON.stringify(s));
  }

  async deleteSnippet(name: string): Promise<boolean> {
    const existed = this.db.prepare("SELECT 1 AS x FROM codemode_snippets WHERE name = ?").get(name) !== undefined;
    this.db.prepare("DELETE FROM codemode_snippets WHERE name = ?").run(name);
    return existed;
  }

  async listSnippets(): Promise<Snippet[]> {
    const rows = this.db.prepare("SELECT body FROM codemode_snippets ORDER BY name").all() as Row[];
    return rows.map((r) => JSON.parse(String(r.body)) as Snippet);
  }
}

/** A Durable Object's SqlStorage, as the store sees it. */
export interface DurableObjectSql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Row[] };
}

/** Adapts a Durable Object's ctx.storage.sql to SqliteDatabase. */
export function durableObjectSql(sql: DurableObjectSql): SqliteDatabase {
  return {
    exec: (query) => sql.exec(query),
    prepare: (query) => ({
      run: (...params) => sql.exec(query, ...params),
      get: (...params) => sql.exec(query, ...params).toArray()[0],
      all: (...params) => sql.exec(query, ...params).toArray(),
    }),
  };
}
