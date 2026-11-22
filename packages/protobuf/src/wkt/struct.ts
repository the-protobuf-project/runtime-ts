// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { invalid } from "@the-protobuf-project/errors";
import { protojson } from "../protojson.ts";
import type { JsonObject, JsonValue, MessageCodec } from "../types.ts";
import { BinaryReader } from "../wire/reader.ts";
import { BinaryWriter, WireType } from "../wire/writer.ts";

function checkValue(json: unknown, path: string): JsonValue {
  if (json === null || typeof json === "boolean" || typeof json === "string") return json;
  if (typeof json === "number") {
    return Number.isFinite(json) ? json : invalid(path, "Value numbers must be finite");
  }
  if (Array.isArray(json)) return json.map((v, i) => checkValue(v, `${path}[${i}]`));
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(protojson.object(json, path))) out[k] = checkValue(v, `${path}.${k}`);
  return out;
}

function encodeValue(v: JsonValue, w: BinaryWriter): BinaryWriter {
  if (v === null) return w.tag(1, WireType.Varint).int32(0);
  if (typeof v === "number") return w.tag(2, WireType.Fixed64).double(v);
  if (typeof v === "string") return w.tag(3, WireType.LengthDelimited).string(v);
  if (typeof v === "boolean") return w.tag(4, WireType.Varint).bool(v);
  if (Array.isArray(v)) {
    w.tag(6, WireType.LengthDelimited).fork();
    encodeList(v, w);
    return w.join();
  }
  w.tag(5, WireType.LengthDelimited).fork();
  encodeStruct(v, w);
  return w.join();
}

function encodeStruct(v: JsonObject, w: BinaryWriter): BinaryWriter {
  for (const [k, item] of Object.entries(v)) {
    w.tag(1, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k);
    w.tag(2, WireType.LengthDelimited).fork();
    encodeValue(item, w);
    w.join().join();
  }
  return w;
}

function encodeList(v: JsonValue[], w: BinaryWriter): BinaryWriter {
  for (const item of v) {
    w.tag(1, WireType.LengthDelimited).fork();
    encodeValue(item, w);
    w.join();
  }
  return w;
}

function reader(input: Uint8Array | BinaryReader): BinaryReader {
  return input instanceof BinaryReader ? input : new BinaryReader(input);
}

function decodeValue(input: Uint8Array | BinaryReader, length?: number): JsonValue {
  const r = reader(input);
  const end = r.end(length);
  let v: JsonValue = null;
  while (r.pos < end) {
    const [no, wt] = r.tag();
    if (no === 1) {
      r.int32();
      v = null;
    } else if (no === 2) v = r.double();
    else if (no === 3) v = r.string();
    else if (no === 4) v = r.bool();
    else if (no === 5) v = decodeStruct(r, r.uint32());
    else if (no === 6) v = decodeList(r, r.uint32());
    else r.skip(wt, no);
  }
  return v;
}

function decodeStruct(input: Uint8Array | BinaryReader, length?: number): JsonObject {
  const r = reader(input);
  const end = r.end(length);
  const out: JsonObject = {};
  while (r.pos < end) {
    const [no, wt] = r.tag();
    if (no !== 1) {
      r.skip(wt, no);
      continue;
    }
    const entryEnd = r.uint32() + r.pos;
    let key = "";
    let value: JsonValue = null;
    while (r.pos < entryEnd) {
      const [eno, ewt] = r.tag();
      if (eno === 1) key = r.string();
      else if (eno === 2) value = decodeValue(r, r.uint32());
      else r.skip(ewt, eno);
    }
    out[key] = value;
  }
  return out;
}

function decodeList(input: Uint8Array | BinaryReader, length?: number): JsonValue[] {
  const r = reader(input);
  const end = r.end(length);
  const out: JsonValue[] = [];
  while (r.pos < end) {
    const [no, wt] = r.tag();
    if (no === 1) out.push(decodeValue(r, r.uint32()));
    else r.skip(wt, no);
  }
  return out;
}

/** google.protobuf.Struct as a JSON object. */
export const StructCodec: MessageCodec<JsonObject> = {
  typeName: "google.protobuf.Struct",
  fromJson: (json, path = "google.protobuf.Struct") => checkValue(protojson.object(json, path), path) as JsonObject,
  toJson: (message) => message,
  encode: (message, writer = new BinaryWriter()) => encodeStruct(message, writer),
  decode: decodeStruct,
};

/** google.protobuf.Value as any JSON value. */
export const ValueCodec: MessageCodec<JsonValue> = {
  typeName: "google.protobuf.Value",
  fromJson: (json, path = "google.protobuf.Value") => checkValue(json, path),
  toJson: (message) => message,
  encode: (message, writer = new BinaryWriter()) => encodeValue(message, writer),
  decode: decodeValue,
};

/** google.protobuf.ListValue as a JSON array. */
export const ListValueCodec: MessageCodec<JsonValue[]> = {
  typeName: "google.protobuf.ListValue",
  fromJson(json, path = "google.protobuf.ListValue") {
    if (!Array.isArray(json)) return invalid(path, `expected a list, got ${JSON.stringify(json)}`);
    return checkValue(json, path) as JsonValue[];
  },
  toJson: (message) => message,
  encode: (message, writer = new BinaryWriter()) => encodeList(message, writer),
  decode: decodeList,
};
