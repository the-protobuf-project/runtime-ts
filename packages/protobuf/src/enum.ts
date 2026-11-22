// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/runtime-ts-errors";
import type { EnumCodec } from "./types.ts";

/** Builds the codec for a generated enum from its [name, number] pairs. */
export function enumCodec<T extends string>(
  typeName: string,
  entries: readonly (readonly [T, number])[],
): EnumCodec<T> {
  const byName = new Map<string, number>(entries);
  const byNumber = new Map<number, T>();
  for (const [name, num] of entries) if (!byNumber.has(num)) byNumber.set(num, name);
  const values = entries.map(([name]) => name);
  const defaultValue = byNumber.get(0) ?? (values[0] as T);

  return {
    typeName,
    values,
    defaultValue,
    toNumber(value: T): number {
      const n = byName.get(value);
      if (n === undefined) return invalid(typeName, `unknown value ${JSON.stringify(value)}`);
      return n;
    },
    fromNumber(value: number): T {
      return byNumber.get(value) ?? defaultValue;
    },
    fromJson(json: unknown, path = typeName): T {
      if (typeof json === "string" && byName.has(json)) return json as T;
      if (typeof json === "number" && Number.isInteger(json)) return byNumber.get(json) ?? defaultValue;
      return invalid(path, `expected one of ${values.join(", ")}, got ${JSON.stringify(json)}`);
    },
  };
}
