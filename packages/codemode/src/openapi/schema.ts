// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { type Document, list, type Node, node, own, text, unescapePointer } from "./document.ts";
import { jsdoc, pascal, propertyKey } from "./names.ts";

const componentPrefix = "#/components/schemas/";
const maxDepth = 32;
// Inline references can branch, so depth alone would let a small spec expand without end.
const maxNodes = 5000;

/** TypeScript for a schema, and the named types it uses. */
export interface Rendered {
  type: string;
  uses: Set<string>;
}

/**
 * Renders a spec's schemas as TypeScript. Component schemas become named types, prefixed
 * with the namespace so two APIs never share a name; everything else is inline.
 */
export class Schemas {
  readonly declarations = new Map<string, string>();
  private readonly doc: Document;
  private readonly prefix: string;
  private readonly names = new Map<string, string>();
  private readonly taken = new Set<string>();
  private readonly uses = new Map<string, Set<string>>();
  private budget = maxNodes;

  constructor(doc: Document, namespace: string) {
    this.doc = doc;
    this.prefix = pascal(namespace);
    const components = node(node(doc.root.components).schemas);
    for (const key of Object.keys(components)) this.names.set(key, this.name(key));
    for (const [key, name] of this.names) {
      const schema = own(components, key);
      const uses = new Set<string>();
      this.budget = maxNodes;
      const type = this.render(schema, "", uses);
      this.uses.set(name, uses);
      this.declarations.set(name, `${jsdoc("", text(node(schema).description))}type ${name} = ${type};\n`);
    }
  }

  /** Reserves a type name in this namespace. */
  name(base: string): string {
    const wanted = this.prefix + pascal(base);
    let name = wanted;
    for (let i = 2; this.taken.has(name) || name === this.prefix; i++) name = `${wanted}${i}`;
    this.taken.add(name);
    return name;
  }

  /** The type of schema, with every named type it reaches. */
  type(schema: unknown, indent = ""): Rendered {
    const direct = new Set<string>();
    this.budget = maxNodes;
    const type = this.render(schema, indent, direct);
    const uses = new Set(direct);
    // A Set also visits what is added while it is iterated, so this is the closure.
    for (const name of uses) for (const next of this.uses.get(name) ?? []) uses.add(next);
    return { type, uses };
  }

  private render(value: unknown, indent: string, uses: Set<string>, depth = 0): string {
    if (value === false) return "never";
    if (depth > maxDepth || --this.budget < 0) return "JsonValue";
    const schema = node(value);
    const next = (child: unknown, at = indent) => this.render(child, at, uses, depth + 1);

    const ref = text(schema.$ref);
    if (ref) {
      const name = ref.startsWith(componentPrefix)
        ? this.names.get(unescapePointer(ref.slice(componentPrefix.length)))
        : undefined;
      if (!name) return next(this.doc.at(ref));
      uses.add(name);
      return schema.nullable === true ? `${name} | null` : name;
    }

    const parts = list(schema.allOf).map((s) => next(s));
    for (const key of ["oneOf", "anyOf"]) {
      const options = new Set(list(schema[key]).map((s) => next(s)));
      if (options.size > 0) parts.push([...options].join(" | "));
    }
    const base = this.base(schema, indent, next);
    if (base !== "JsonValue") parts.push(base);
    // allOf around one $ref is how a description is attached to a reference in 3.0.
    const meaningful = [...new Set(parts.filter((p) => p !== "JsonValue"))];
    const type = meaningful.length === 1 ? (meaningful[0] ?? "") : meaningful.map(group).join(" & ") || "JsonValue";
    return schema.nullable === true && type !== "JsonValue" ? `${group(type)} | null` : type;
  }

  private base(schema: Node, indent: string, next: (child: unknown, at?: string) => string): string {
    if (schema.const !== undefined) return literal(schema.const);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map(literal).join(" | ");
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const out = types.map((type) => {
      switch (type) {
        case "string":
        case "boolean":
        case "null":
          return type;
        case "integer":
        case "number":
          return "number";
        case "array":
          return schema.items === undefined ? "JsonValue[]" : `${group(next(schema.items))}[]`;
        case "object":
          return this.object(schema, indent, next);
        default:
          if (schema.properties !== undefined) return this.object(schema, indent, next);
          return schema.items === undefined ? "JsonValue" : `${group(next(schema.items))}[]`;
      }
    });
    return [...new Set(out)].join(" | ");
  }

  private object(schema: Node, indent: string, next: (child: unknown, at?: string) => string): string {
    const properties = Object.entries(node(schema.properties));
    const extra = schema.additionalProperties;
    if (properties.length === 0) {
      if (extra === false) return "Record<string, never>";
      const value = extra === undefined || extra === true ? "JsonValue" : next(extra);
      // An index signature, not Record: Record cannot refer to the alias being defined.
      return `{ [key: string]: ${value} }`;
    }
    const required = new Set(list(schema.required));
    const inner = `${indent}  `;
    const lines = properties.map(([key, child]) => {
      const c = node(child);
      // Servers set read-only properties, so a request must be able to leave them out.
      const readOnly = c.readOnly === true;
      const doc = jsdoc(inner, text(c.description), readOnly ? "Read-only; ignored in requests." : "", format(c));
      const optional = required.has(key) && !readOnly ? "" : "?";
      return `${doc}${inner}${propertyKey(key)}${optional}: ${next(child, inner)};\n`;
    });
    const object = `{\n${lines.join("")}${indent}}`;
    return extra !== undefined && extra !== false ? `${object} & { [key: string]: JsonValue }` : object;
  }
}

/** Wraps a union or intersection so it can be combined. */
function group(type: string): string {
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    const c = type.charAt(i);
    if (c === '"') {
      // Skip a string literal, whose brackets and bars mean nothing.
      i++;
      while (i < type.length && type.charAt(i) !== '"') i += type.charAt(i) === "\\" ? 2 : 1;
    } else if (c === "/" && type.charAt(i + 1) === "*") {
      const end = type.indexOf("*/", i + 2);
      i = end < 0 ? type.length : end + 1;
    } else if ("({[<".includes(c)) depth++;
    else if (")}]>".includes(c)) depth--;
    else if (depth === 0 && (c === "|" || c === "&")) return `(${type})`;
  }
  return type;
}

function literal(value: unknown): string {
  return value !== null && typeof value === "object" ? "JsonValue" : JSON.stringify(value ?? null);
}

function format(schema: Node): string {
  const name = text(schema.format);
  return ["date", "date-time", "byte", "uuid"].includes(name) ? `Format: ${name}.` : "";
}
