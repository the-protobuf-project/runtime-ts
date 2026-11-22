// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { type Document, list, node, own, text } from "./document.ts";

/** One parameter, under the key the sandbox passes it as. */
export interface Parameter {
  key: string;
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  style: string;
  explode: boolean;
  /** Sent as JSON text: the parameter declares content instead of a schema. */
  json: boolean;
  schema: unknown;
  description: string;
  /** The keys an exploded object may send, which become query names of their own. */
  fields: readonly string[];
}

// Headers that HTTP, fetch or the host own. A sandbox input must never set one.
const hostHeaders = new Set(
  `accept authorization connection content-length content-type cookie forwarded host proxy-authorization te trailer
   transfer-encoding upgrade`.split(/\s+/),
);

// Ways to turn an approved or unapproved request into another method.
const overrides = new Set(
  `_method _httpmethod $httpmethod x-http-method x-http-method-override x-method-override`.split(/\s+/),
);

const styles: Readonly<Record<Parameter["in"], readonly string[]>> = {
  path: ["simple"],
  header: ["simple"],
  query: ["form", "spaceDelimited", "pipeDelimited", "deepObject"],
};

/** Reports whether a name switches the HTTP method server-side. */
export function isOverride(name: string): boolean {
  return overrides.has(name.toLowerCase());
}

/** Reports whether the spec's security schemes send a credential in this place. */
export function isCredential(doc: Document, where: string, name: string): boolean {
  return Object.values(node(node(doc.root.components).securitySchemes)).some((value) => {
    const scheme = doc.resolve(value);
    return scheme.type === "apiKey" && scheme.in === where && text(scheme.name).toLowerCase() === name.toLowerCase();
  });
}

/** Reports whether only the host may set a parameter. */
function hostOwned(doc: Document, where: Parameter["in"], name: string): boolean {
  if (isOverride(name) || isCredential(doc, where, name)) return true;
  const lower = name.toLowerCase();
  return where === "header" && (hostHeaders.has(lower) || lower.startsWith("x-forwarded-"));
}

/**
 * Reads an operation's parameters, later ones overriding earlier ones of the same place
 * and name. Cookies, credentials and method overrides are left out: the host owns them.
 * Returns the reason when the operation cannot be called faithfully.
 */
export function readParameters(doc: Document, values: readonly unknown[]): Parameter[] | string {
  const byPlace = new Map<string, ReturnType<Document["resolve"]>>();
  for (const value of values) {
    const p = doc.resolve(value);
    byPlace.set(`${text(p.in)}:${text(p.name)}`, p);
  }

  const out: Parameter[] = [];
  const keys = new Set(["body"]);
  for (const p of byPlace.values()) {
    const name = text(p.name);
    const where = p.in;
    if (where === "cookie") continue;
    if (where !== "path" && where !== "query" && where !== "header") return `parameters in ${text(where)} are unknown`;
    if (hostOwned(doc, where, name)) continue;

    const style = text(p.style) || (where === "query" ? "form" : "simple");
    if (!styles[where].includes(style)) return `${where} parameter ${name} has unsupported style ${style}`;

    let key = name;
    while (keys.has(key) || key === "__proto__") key = `${where}_${key}`;
    keys.add(key);

    const media = Object.values(node(p.content));
    const schema = media.length > 0 ? node(media[0]).schema : p.schema;
    out.push({
      key,
      name,
      in: where,
      required: where === "path" || p.required === true,
      style,
      explode: typeof p.explode === "boolean" ? p.explode : style === "form",
      json: media.length > 0,
      schema,
      description: text(p.description),
      fields: fieldsOf(doc, schema),
    });
  }
  return out;
}

/** An object schema's own property names, and those of its allOf parts. */
function fieldsOf(doc: Document, schema: unknown, seen = new Set<object>()): string[] {
  if (schema === undefined) return [];
  const resolved = doc.resolve(schema);
  if (seen.has(resolved)) return [];
  seen.add(resolved);
  const properties = node(own(resolved, "properties"));
  const inherited = list(resolved.allOf).flatMap((part) => fieldsOf(doc, part, seen));
  return [...Object.keys(properties), ...inherited].filter(
    (name) => !isOverride(name) && !isCredential(doc, "query", name),
  );
}
