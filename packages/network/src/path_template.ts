// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/errors";
import type { JsonObject, JsonValue } from "@the-protobuf-project/protobuf";

const variable = /\{([a-zA-Z0-9_.]+)(?:=([^}]*))?\}/g;

/** Converts a proto field path ("book.display_name") to JSON names. */
export function jsonPath(protoPath: string): string[] {
  return protoPath.split(".").map((s) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()));
}

/** Reads a nested field from protojson. */
export function getPath(json: JsonObject, path: readonly string[]): JsonValue | undefined {
  let at: JsonValue | undefined = json;
  for (const key of path) {
    if (typeof at !== "object" || at === null || Array.isArray(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** Removes a nested field from protojson, in place. */
export function deletePath(json: JsonObject, path: readonly string[]): void {
  let at: JsonValue | undefined = json;
  for (const key of path.slice(0, -1)) {
    if (typeof at !== "object" || at === null || Array.isArray(at)) return;
    at = at[key];
  }
  if (typeof at === "object" && at !== null && !Array.isArray(at)) delete at[path.at(-1) as string];
}

/**
 * Expands a google.api.http path template with values from the request.
 * Returns the path and the JSON paths it consumed.
 */
export function expandPath(template: string, json: JsonObject): { path: string; bound: string[][] } {
  const bound: string[][] = [];
  const path = template.replace(variable, (_, field: string) => {
    const p = jsonPath(field);
    const value = getPath(json, p);
    if (value === undefined || value === null || value === "") {
      return invalid(field, `required by the URL ${template} but not set`);
    }
    bound.push(p);
    return String(value).split("/").map(encodeURIComponent).join("/");
  });
  return { path, bound };
}

/** Flattens the remaining request fields into URL query parameters. */
export function toQuery(json: JsonValue, prefix = "", out = new URLSearchParams()): URLSearchParams {
  if (json === null || json === undefined) return out;
  if (Array.isArray(json)) {
    for (const v of json) toQuery(v, prefix, out);
  } else if (typeof json === "object") {
    for (const [k, v] of Object.entries(json)) toQuery(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.append(prefix, String(json));
  }
  return out;
}
