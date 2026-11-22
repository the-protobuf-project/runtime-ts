// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { protojson } from "../protojson.ts";
import type { JsonObject, JsonValue, MessageCodec } from "../types.ts";
import { invalid } from "@the-protobuf-project/runtime-ts-errors";
import { lookupType } from "../registry.ts";
import { BinaryReader } from "../wire/reader.ts";
import { BinaryWriter, WireType } from "../wire/writer.ts";

/** google.protobuf.Any in protojson form: "@type" plus the message's fields. */
export interface AnyMessage {
  "@type": string;
  [field: string]: unknown;
}

/** Well-known types whose protojson is not an object nest under "value". */
const nested = new Set([
  "google.protobuf.Timestamp", "google.protobuf.Duration", "google.protobuf.FieldMask",
  "google.protobuf.Struct", "google.protobuf.Value", "google.protobuf.ListValue",
  "google.protobuf.DoubleValue", "google.protobuf.FloatValue", "google.protobuf.Int64Value",
  "google.protobuf.UInt64Value", "google.protobuf.Int32Value", "google.protobuf.UInt32Value",
  "google.protobuf.BoolValue", "google.protobuf.StringValue", "google.protobuf.BytesValue",
  "google.protobuf.Any",
]);

function typeNameOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function codecFor(url: string, path: string): MessageCodec<unknown> {
  return lookupType(typeNameOf(url)) ?? invalid(path, `no codec registered for ${url}`);
}

/** google.protobuf.Any. Binary encoding needs the packed type registered. */
export const AnyCodec: MessageCodec<AnyMessage> = {
  typeName: "google.protobuf.Any",
  fromJson(json, path = "google.protobuf.Any") {
    const o = protojson.object(json, path);
    if (typeof o["@type"] !== "string") return invalid(path, `Any needs a string "@type"`);
    return o as AnyMessage;
  },
  toJson: (message) => message as unknown as JsonValue,
  encode(message, writer = new BinaryWriter()) {
    const url = message["@type"];
    const codec = codecFor(url, "google.protobuf.Any");
    const { "@type": _, ...fields } = message;
    const inner = nested.has(codec.typeName) ? fields["value"] : fields;
    writer.tag(1, WireType.LengthDelimited).string(url);
    writer.tag(2, WireType.LengthDelimited).bytes(codec.encode(codec.fromJson(inner)).finish());
    return writer;
  },
  decode(input, length) {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = r.end(length);
    let url = "";
    let value: Uint8Array = new Uint8Array();
    while (r.pos < end) {
      const [no, wt] = r.tag();
      if (no === 1) url = r.string();
      else if (no === 2) value = r.bytes();
      else r.skip(wt, no);
    }
    const codec = codecFor(url, "google.protobuf.Any");
    const json = codec.toJson(codec.decode(value));
    if (nested.has(codec.typeName)) return { "@type": url, value: json };
    return { "@type": url, ...(json as JsonObject) };
  },
};

/** google.protobuf.Empty. */
export type Empty = Record<string, never>;

/** google.protobuf.Empty as `{}`. */
export const EmptyCodec: MessageCodec<Empty> = {
  typeName: "google.protobuf.Empty",
  fromJson: (json, path = "google.protobuf.Empty") => (protojson.object(json, path), {}),
  toJson: () => ({}),
  encode: (_message, writer = new BinaryWriter()) => writer,
  decode(input, length) {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = r.end(length);
    while (r.pos < end) {
      const [no, wt] = r.tag();
      r.skip(wt, no);
    }
    return {};
  },
};
