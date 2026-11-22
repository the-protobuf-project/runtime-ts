// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { sandboxPrelude } from "../catalog/prelude.ts";
import type { Catalog, CatalogMethod } from "../catalog/types.ts";
import { type Document, node, text } from "./document.ts";
import { jsdoc, propertyKey } from "./names.ts";
import type { Operation } from "./operations.ts";
import { Schemas } from "./schema.ts";

const maxInstructions = 300;

/** Describes a spec's operations to search(), describe() and the tool description. */
export function buildCatalog(
  doc: Document,
  namespace: string,
  instructions: string | undefined,
  operations: readonly Operation[],
  requiresApproval: (op: Operation) => boolean,
): Catalog {
  const schemas = new Schemas(doc, namespace);
  const types = new Map(schemas.declarations);

  const methods = operations.map((op): CatalogMethod => {
    const used = new Set<string>();
    const render = (schema: unknown, indent = "") => {
      const { type, uses } = schemas.type(schema, indent);
      for (const name of uses) used.add(name);
      return type;
    };

    const fields = op.parameters.map((p) => {
      const doc = jsdoc("  ", p.description);
      return `${doc}  ${propertyKey(p.key)}${p.required ? "" : "?"}: ${render(p.schema, "  ")};\n`;
    });
    if (op.body) fields.push(`  body${op.body.required ? "" : "?"}: ${render(op.body.schema, "  ")};\n`);

    let input = "";
    if (fields.length > 0) {
      const name = schemas.name(`${op.name} input`);
      types.set(name, `type ${name} = {\n${fields.join("")}};\n`);
      used.add(name);
      const optional = !op.body?.required && op.parameters.every((p) => !p.required);
      input = `input${optional ? "?" : ""}: ${name}`;
    }

    const results = op.results.map((result) => {
      if (result.kind === "empty") return "null";
      return result.kind === "text" ? "string" : render(result.schema, "  ");
    });
    const output = [...new Set(results)].join(" | ") || "JsonValue";

    const approval = requiresApproval(op);
    const doc = jsdoc(
      "  ",
      op.summary,
      `${op.method} ${op.path}`,
      approval ? "Requires approval: the execution pauses until a person approves this call." : "",
    );
    return {
      path: `${namespace}.${op.name}`,
      namespace,
      name: op.name,
      rpc: op.id,
      description: op.summary || `${op.method} ${op.path}`,
      requiresApproval: approval,
      replay: "log",
      readOnly: op.readOnly,
      declaration: `${doc}  ${op.name}(${input}): Promise<${output}>;\n`,
      types: [...used].sort(),
      examples: [],
    };
  });

  const info = node(doc.root.info);
  const service = text(info.title) || namespace;
  // The spec's own text lands in the tool description, so it is kept to one short line.
  const about = [service, text(info.description)].filter(Boolean).join(": ").replace(/\s+/g, " ");
  const guidance = instructions ?? (about.length > maxInstructions ? `${about.slice(0, maxInstructions)}...` : about);
  const body = methods.map((m) => m.declaration).join("\n");
  return {
    prelude: sandboxPrelude,
    types: Object.fromEntries(types),
    namespaces: [
      {
        name: namespace,
        service,
        instructions: guidance,
        declaration: `${jsdoc("", guidance)}declare const ${namespace}: {\n${body}};\n`,
        methods: methods.map((m) => m.path),
      },
    ],
    methods,
    snippets: [],
  };
}
