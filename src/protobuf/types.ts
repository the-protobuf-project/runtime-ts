// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { BinaryReader } from "./wire/reader.ts";
import type { BinaryWriter } from "./wire/writer.ts";

/** A JSON value, as protojson produces it. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

/** A JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Converts one message type between its interface, protojson and the protobuf
 * binary format. Every generated message has one, named `<Message>Codec`.
 */
export interface MessageCodec<T> {
  /** Fully qualified protobuf name, e.g. "library.v1.Book". */
  readonly typeName: string;
  /** Validates protojson and returns the message. Throws INVALID_ARGUMENT. */
  fromJson(json: unknown, path?: string): T;
  /** Returns protojson, leaving out fields that hold their default unless told otherwise. */
  toJson(message: T, options?: ToJsonOptions): JsonValue;
  /** Appends the binary encoding to writer, or a new one. */
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  /** Decodes binary input; with length, reads that many bytes from a reader. */
  decode(input: Uint8Array | BinaryReader, length?: number): T;
}

/** Options for MessageCodec.toJson. */
export interface ToJsonOptions {
  /**
   * Write fields that hold their default (empty strings, zero, empty lists
   * and maps), as protojson's EmitDefaultValues does. Sandboxed code gets
   * results this way, so `page.books.length` works on an empty page.
   */
  emitDefaults?: boolean;
}

/** Converts one enum type between its value names and numbers. */
export interface EnumCodec<T extends string> {
  readonly typeName: string;
  /** Every value name, in declaration order. */
  readonly values: readonly T[];
  /** The value numbered zero. */
  readonly defaultValue: T;
  toNumber(value: T): number;
  /** Unknown numbers map to the default value. */
  fromNumber(value: number): T;
  /** Accepts a value name or number. Throws INVALID_ARGUMENT. */
  fromJson(json: unknown, path?: string): T;
}

/** Infers the message type a codec converts. */
export type MessageOf<C> = C extends MessageCodec<infer T> ? T : never;
