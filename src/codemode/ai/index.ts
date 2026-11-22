// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { jsonSchema, tool } from "ai";
import type { CodemodeRuntime } from "../runtime/runtime.ts";
import type { CodeInput } from "../runtime/types.ts";

/**
 * The codemode tool for the Vercel AI SDK.
 *
 * ```ts
 * const result = await generateText({ model, prompt, tools: { codemode: codemodeTool(runtime) } });
 * ```
 */
export function codemodeTool(runtime: CodemodeRuntime) {
  const t = runtime.tool();
  return tool({
    description: t.description,
    inputSchema: jsonSchema<CodeInput>({
      type: "object",
      properties: { code: { type: "string", description: "An async arrow function, e.g. async () => { ... }" } },
      required: ["code"],
      additionalProperties: false,
    }),
    execute: (input: CodeInput) => t.execute(input),
  });
}
