// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/runtime-ts/errors";
import type { RuntimeState } from "./state.ts";
import type { Snippet } from "./types.ts";

/** Options for saving a snippet. */
export interface SaveSnippetOptions {
  /** The completed execution whose code becomes the snippet. */
  executionId: string;
  description?: string;
  /** JSON Schema for the snippet's input, shown by describe(). */
  inputSchema?: unknown;
}

const validName = /^[A-Za-z_][\w.-]{0,127}$/;

/** Saves a completed execution's code under name, replacing any snippet of that name. */
export async function saveSnippet(state: RuntimeState, name: string, options: SaveSnippetOptions): Promise<Snippet> {
  if (!validName.test(name)) throw new StatusError("INVALID_ARGUMENT", `snippet name ${JSON.stringify(name)} is not valid`);
  if (state.methods.has(name) || state.catalog.namespaces.some((n) => n.name === name)) {
    throw new StatusError("ALREADY_EXISTS", `${name} is a namespace or method name`);
  }
  const exec = await state.store.getExecution(options.executionId);
  if (!exec) throw new StatusError("NOT_FOUND", `no execution ${options.executionId}`);
  if (exec.status !== "completed") {
    throw new StatusError("FAILED_PRECONDITION", `only completed executions can be saved; ${exec.id} is ${exec.status}`);
  }
  await state.snippetList();
  const snippet: Snippet = {
    name,
    code: exec.code,
    source: "saved",
    createdAt: Date.now(),
    ...(options.description ? { description: options.description } : {}),
    ...(options.inputSchema !== undefined ? { inputSchema: options.inputSchema } : {}),
  };
  await state.store.putSnippet(snippet);
  return snippet;
}

/** Deletes a snippet. Reports whether it existed. */
export function deleteSnippet(state: RuntimeState, name: string): Promise<boolean> {
  return state.store.deleteSnippet(name);
}
