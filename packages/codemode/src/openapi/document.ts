// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** A JSON object of unknown shape: a spec is read without trusting its structure. */
export type Node = Readonly<Record<string, unknown>>;

/** Returns value as an object, or an empty one. */
export function node(value: unknown): Node {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};
}

/** Returns value as an array, or an empty one. */
export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Returns value as a string, or "". */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reads an own property, so "constructor" in a spec is only a name. */
export function own(object: unknown, key: string): unknown {
  const n = node(object);
  return Object.hasOwn(n, key) ? n[key] : undefined;
}

/** A parsed OpenAPI 3.0 or 3.1 document, and the resolution of its local references. */
export class Document {
  readonly root: Node;

  constructor(spec: object | string) {
    let parsed: unknown = spec;
    if (typeof spec === "string") {
      try {
        parsed = JSON.parse(spec);
      } catch {
        throw new Error("openapi: the spec text is not JSON; parse YAML first, e.g. Bun.YAML.parse(text)");
      }
    }
    this.root = node(parsed);
    if (!/^3\.[01](\.|$)/.test(text(this.root.openapi))) {
      throw new Error("openapi: only OpenAPI 3.0 and 3.1 are supported");
    }
  }

  /** Returns what a local pointer such as "#/components/schemas/Book" names. */
  at(ref: string): unknown {
    if (!ref.startsWith("#/")) {
      throw new Error(`openapi: ${ref} is not a local reference; bundle the spec into one document`);
    }
    let value: unknown = this.root;
    for (const part of ref.slice(2).split("/")) {
      const key = unescapePointer(part);
      value = Array.isArray(value) ? value[Number(key)] : own(value, key);
      if (value === undefined) throw new Error(`openapi: ${ref} does not resolve`);
    }
    return value;
  }

  /** Follows references until something that is not one. */
  resolve(value: unknown): Node {
    const seen = new Set<string>();
    let current = node(value);
    for (let ref = text(current.$ref); ref; ref = text(current.$ref)) {
      if (seen.has(ref)) throw new Error(`openapi: ${ref} refers to itself`);
      seen.add(ref);
      current = node(this.at(ref));
    }
    return current;
  }
}

/** Undoes JSON Pointer and percent escaping. */
export function unescapePointer(part: string): string {
  return decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~");
}
