// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/runtime-ts/errors";
import { BinaryReader } from "./wire/reader.ts";
import { BinaryWriter, WireType } from "./wire/writer.ts";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import type { MessageCodec } from "./types.ts";

/** Reads one value of a known type from a reader positioned after its tag. */
export type ValueReader<T> = (reader: BinaryReader) => T;

/** Binary helpers used by generated codecs. */
export const binary = {
  /** Converts a protojson bytes field to raw bytes. */
  bytesIn(value: string): Uint8Array {
    return decodeBase64(value) ?? invalid("bytes", "not base64");
  },

  /** Converts raw bytes to a protojson bytes field. */
  bytesOut(value: Uint8Array): string {
    return encodeBase64(value);
  },

  /** Writes a message field as a length-delimited section. */
  message<T>(writer: BinaryWriter, fieldNo: number, codec: MessageCodec<T>, value: T): void {
    writer.tag(fieldNo, WireType.LengthDelimited).fork();
    codec.encode(value, writer);
    writer.join();
  },

  /** Reads a message field from a reader positioned after its tag. */
  readMessage<T>(reader: BinaryReader, codec: MessageCodec<T>): T {
    return codec.decode(reader, reader.uint32());
  },

  /** Reads a repeated scalar in packed or unpacked form into list. */
  packed<T>(reader: BinaryReader, wireType: WireType, read: ValueReader<T>, list: T[]): T[] {
    if (wireType === WireType.LengthDelimited) {
      const end = reader.uint32() + reader.pos;
      while (reader.pos < end) list.push(read(reader));
    } else {
      list.push(read(reader));
    }
    return list;
  },

  /** Reads one map entry, filling in defaults for a missing key or value. */
  mapEntry<K, V>(
    reader: BinaryReader,
    readKey: ValueReader<K>,
    readValue: ValueReader<V>,
    keyDefault: K,
    valueDefault: () => V,
  ): [K, V] {
    const end = reader.uint32() + reader.pos;
    let key = keyDefault;
    let value: V | undefined;
    while (reader.pos < end) {
      const [no, wt] = reader.tag();
      if (no === 1) key = readKey(reader);
      else if (no === 2) value = readValue(reader);
      else reader.skip(wt, no);
    }
    return [key, value ?? valueDefault()];
  },
} as const;

/** Encodes a message to bytes. */
export function toBinary<T>(codec: MessageCodec<T>, message: T): Uint8Array {
  return codec.encode(message).finish();
}

/** Decodes a message from bytes. */
export function fromBinary<T>(codec: MessageCodec<T>, bytes: Uint8Array): T {
  return codec.decode(new BinaryReader(bytes));
}

/** Converts a message to a JSON string. */
export function toJsonString<T>(codec: MessageCodec<T>, message: T): string {
  return JSON.stringify(codec.toJson(message));
}

/** Parses a message from a JSON string. */
export function fromJsonString<T>(codec: MessageCodec<T>, text: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return invalid(codec.typeName, `malformed JSON: ${(e as Error).message}`);
  }
  return codec.fromJson(parsed);
}
