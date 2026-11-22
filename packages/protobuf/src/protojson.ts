// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/errors";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import type { EnumCodec, JsonValue, MessageCodec } from "./types.ts";

/** Reads one protojson value; undefined when the field is absent or null. */
export type JsonReader<T> = (value: unknown, path: string) => T | undefined;

const int64Pattern = /^-?\d+$/;

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function describe(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function integer(value: unknown, path: string, min: number, max: number): number | undefined {
  if (!present(value)) return undefined;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    return invalid(path, `expected an integer in [${min}, ${max}], got ${describe(value)}`);
  }
  return n;
}

function bigInteger(value: unknown, path: string, unsigned: boolean): string | undefined {
  if (!present(value)) return undefined;
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !int64Pattern.test(text)) {
    return invalid(path, `expected a 64-bit integer, got ${describe(value)}`);
  }
  const big = BigInt(text);
  const ok = unsigned ? big >= 0n && big < 1n << 64n : big >= -(1n << 63n) && big < 1n << 63n;
  if (!ok) return invalid(path, `64-bit integer out of range: ${text}`);
  return big.toString();
}

/** protojson readers and writers used by generated codecs. */
export const protojson = {
  /** Requires a JSON object. */
  object(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return invalid(path, `expected an object, got ${describe(value)}`);
    }
    return value as Record<string, unknown>;
  },

  /** Reads a field by its JSON name, falling back to the proto field name. */
  get(object: Record<string, unknown>, jsonName: string, protoName: string): unknown {
    const v = object[jsonName];
    return v === undefined && protoName !== jsonName ? object[protoName] : v;
  },

  string(value: unknown, path: string): string | undefined {
    if (!present(value)) return undefined;
    return typeof value === "string" ? value : invalid(path, `expected a string, got ${describe(value)}`);
  },

  bool(value: unknown, path: string): boolean | undefined {
    if (!present(value)) return undefined;
    return typeof value === "boolean" ? value : invalid(path, `expected a boolean, got ${describe(value)}`);
  },

  float(value: unknown, path: string): number | undefined {
    if (!present(value)) return undefined;
    if (typeof value === "number") return value;
    if (value === "NaN") return Number.NaN;
    if (value === "Infinity") return Number.POSITIVE_INFINITY;
    if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    return Number.isNaN(n) ? invalid(path, `expected a number, got ${describe(value)}`) : n;
  },

  int32(value: unknown, path: string): number | undefined {
    return integer(value, path, -2147483648, 2147483647);
  },

  uint32(value: unknown, path: string): number | undefined {
    return integer(value, path, 0, 4294967295);
  },

  int64(value: unknown, path: string): string | undefined {
    return bigInteger(value, path, false);
  },

  uint64(value: unknown, path: string): string | undefined {
    return bigInteger(value, path, true);
  },

  /** Validates base64 and normalises it to the standard alphabet. */
  bytes(value: unknown, path: string): string | undefined {
    if (!present(value)) return undefined;
    const bytes = typeof value === "string" ? decodeBase64(value) : undefined;
    return bytes ? encodeBase64(bytes) : invalid(path, `expected base64, got ${describe(value)}`);
  },

  enumOf<T extends string>(codec: EnumCodec<T>): JsonReader<T> {
    return (value, path) => (present(value) ? codec.fromJson(value, path) : undefined);
  },

  message<T>(codec: MessageCodec<T>): JsonReader<T> {
    const acceptsNull = codec.typeName === "google.protobuf.Value";
    return (value, path) =>
      present(value) || (acceptsNull && value === null) ? codec.fromJson(value, path) : undefined;
  },

  list<T>(read: JsonReader<T>): JsonReader<T[]> {
    return (value, path) => {
      if (!present(value)) return undefined;
      if (!Array.isArray(value)) return invalid(path, `expected a list, got ${describe(value)}`);
      return value.map((item, i) => read(item, `${path}[${i}]`) ?? invalid(`${path}[${i}]`, "null in list"));
    };
  },

  map<T>(read: JsonReader<T>): JsonReader<Record<string, T>> {
    return (value, path) => {
      if (!present(value)) return undefined;
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(protojson.object(value, path))) {
        out[k] = read(v, `${path}[${JSON.stringify(k)}]`) ?? invalid(`${path}.${k}`, "null in map");
      }
      return out;
    };
  },

  /** Rejects a request that leaves a REQUIRED message field unset. */
  missing(path: string): never {
    return invalid(path, "required field is not set");
  },

  /** Rejects a message that sets more than one member of a oneof. */
  oneof(message: object, path: string, name: string, fields: readonly string[]): void {
    const set = fields.filter((f) => (message as Record<string, unknown>)[f] !== undefined);
    if (set.length > 1) invalid(path, `oneof ${name} allows one of ${fields.join(", ")}, got ${set.join(", ")}`);
  },

  /** Writes a float as protojson does, spelling NaN and infinities as strings. */
  floatOut(value: number): JsonValue {
    if (Number.isNaN(value)) return "NaN";
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    return value;
  },

  /** Maps the values of a map field. */
  mapOut<T>(map: Record<string, T>, write: (value: T) => JsonValue): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(map)) out[k] = write(v);
    return out;
  },

  /** Reports whether a map or list field holds anything. */
  nonEmpty(value: object | undefined): boolean {
    return value !== undefined && Object.keys(value).length > 0;
  },
} as const;
