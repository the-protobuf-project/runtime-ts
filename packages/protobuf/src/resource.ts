// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/runtime-ts-errors";

/** Formats, parses and checks names of one google.api.resource pattern. */
export interface ResourceName<V extends string, N extends string> {
  /** The resource type, e.g. "library.example.com/Book". */
  readonly type: string;
  /** The pattern, e.g. "shelves/{shelf}/books/{book}". */
  readonly pattern: string;
  /** Builds a name from its variables. Throws if a value contains "/". */
  format(vars: Record<V, string>): N;
  /** Splits a name into its variables. Throws if it does not match. */
  parse(name: string): Record<V, string>;
  /** Reports whether a string matches the pattern. */
  matches(name: string): name is N;
}

const variable = /\{([a-z0-9_]+)(?:=[^}]*)?\}/g;

/** Builds the helper generated resource names export. */
export function resourceName<V extends string, N extends string>(type: string, pattern: string): ResourceName<V, N> {
  const vars: string[] = [];
  const source = pattern
    .split(variable)
    .map((part, i) => {
      if (i % 2 === 1) {
        vars.push(part);
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const regex = new RegExp(`^${source}$`);

  return {
    type,
    pattern,
    format(values: Record<V, string>): N {
      return pattern.replace(variable, (_, name: string) => {
        const v = (values as Record<string, string>)[name];
        if (!v || v.includes("/")) return invalid(type, `variable ${name} must be a non-empty segment, got ${JSON.stringify(v)}`);
        return v;
      }) as N;
    },
    parse(name: string): Record<V, string> {
      const m = regex.exec(name);
      if (!m) return invalid(type, `${JSON.stringify(name)} does not match ${pattern}`);
      const out: Record<string, string> = {};
      vars.forEach((v, i) => (out[v] = m[i + 1] as string));
      return out as Record<V, string>;
    },
    matches(name: string): name is N {
      return regex.test(name);
    },
  };
}
