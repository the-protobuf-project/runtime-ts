// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { Catalog } from "../catalog/types.ts";
import type { CodeInput, CodeOutput } from "./types.ts";

/** A framework-neutral tool: adapt it to MCP, the AI SDK or anything else. */
export interface CodemodeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: CodeInput): Promise<CodeOutput>;
}

const rules = `Run JavaScript in a sandbox to work with the APIs below. Write one async arrow function, such as
async () => { const page = await ns.list({}); return page.items.length; }
and return the value you need. The sandbox has no network or filesystem; the namespaces are the only way out.

Rules:
- Await each call before the next, in a fixed order. Do not use Promise.all: executions are replayed after approvals.
- Wrap Date.now(), Math.random() and other changing values in codemode.step(name, fn).
- Calls fail with errors that carry a gRPC code, e.g. e.code === "NOT_FOUND".
- Some calls need a person's approval. The tool then returns status "paused"; the call runs once approved.
- Return only what you need: large results are truncated.`;

const streams = `
- Streaming methods are one call each. A server-streaming or bidi method returns { messages, complete } once its stream
  ends, or after options.limit replies (default 100) or options.timeoutMs (default 10000); complete is false when it was
  cut short. Client-streaming and bidi methods take an array of requests.`;

/** Builds the codemode tool description from the catalog. */
export function toolDescription(catalog: Catalog, discovery: "progressive" | "inline"): string {
  const howTo = catalog.methods.some((m) => m.streaming) ? `${rules}${streams}` : rules;
  if (discovery === "inline") {
    const used = [...new Set(catalog.methods.flatMap((m) => m.types))].sort();
    const types = used.map((t) => catalog.types[t] ?? "").join("\n");
    const namespaces = catalog.namespaces.map((n) => n.declaration).join("\n");
    return `${howTo}\n\nThe sandbox API:\n\n${catalog.prelude}\n${types}\n${namespaces}`;
  }
  const list = catalog.namespaces.map((n) => `- ${n.name} (${n.methods.length} methods): ${n.instructions}`).join("\n");
  const snippets =
    catalog.snippets.length > 0
      ? `\n\nSnippets you can run with codemode.run(name, input): ${catalog.snippets.map((s) => s.name).join(", ")}.`
      : "";
  return `${howTo}
- Before calling a method you have not used, look it up: await codemode.describe("namespace.method") returns its TypeScript.
  codemode.search("keywords") finds methods; codemode.describe("namespace") lists a whole namespace.

Namespaces:
${list}${snippets}

The codemode API:

${catalog.prelude}`;
}
