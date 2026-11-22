// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { binary } from "../binary.ts";
import { protojson, type JsonReader } from "../protojson.ts";
import type { JsonValue, MessageCodec } from "../types.ts";
import { invalid } from "@the-protobuf-project/errors";
import { BinaryReader } from "../wire/reader.ts";
import { BinaryWriter, WireType } from "../wire/writer.ts";

function wrapper<T extends JsonValue>(
  name: string,
  read: JsonReader<T>,
  wireType: WireType,
  write: (w: BinaryWriter, v: T) => void,
  readBinary: (r: BinaryReader) => T,
  zero: T,
): MessageCodec<T | null> {
  const typeName = `google.protobuf.${name}`;
  return {
    typeName,
    fromJson: (json, path = typeName) => (json === null ? null : (read(json, path) ?? invalid(path, "missing value"))),
    toJson: (message) => message,
    encode(message, writer = new BinaryWriter()) {
      if (message !== null && message !== zero) write(writer.tag(1, wireType), message);
      return writer;
    },
    decode(input, length) {
      const r = input instanceof BinaryReader ? input : new BinaryReader(input);
      const end = r.end(length);
      let v = zero;
      while (r.pos < end) {
        const [no, wt] = r.tag();
        if (no === 1) v = readBinary(r);
        else r.skip(wt, no);
      }
      return v;
    },
  };
}

const V = WireType.Varint;

/** google.protobuf.DoubleValue as `number | null`. */
export const DoubleValueCodec = wrapper("DoubleValue", protojson.float, WireType.Fixed64, (w, v) => w.double(v), (r) => r.double(), 0);
/** google.protobuf.FloatValue as `number | null`. */
export const FloatValueCodec = wrapper("FloatValue", protojson.float, WireType.Fixed32, (w, v) => w.float(v), (r) => r.float(), 0);
/** google.protobuf.Int64Value as `string | null`. */
export const Int64ValueCodec = wrapper("Int64Value", protojson.int64, V, (w, v) => w.int64(v), (r) => r.int64(), "0");
/** google.protobuf.UInt64Value as `string | null`. */
export const UInt64ValueCodec = wrapper("UInt64Value", protojson.uint64, V, (w, v) => w.uint64(v), (r) => r.uint64(), "0");
/** google.protobuf.Int32Value as `number | null`. */
export const Int32ValueCodec = wrapper("Int32Value", protojson.int32, V, (w, v) => w.int32(v), (r) => r.int32(), 0);
/** google.protobuf.UInt32Value as `number | null`. */
export const UInt32ValueCodec = wrapper("UInt32Value", protojson.uint32, V, (w, v) => w.uint32(v), (r) => r.uint32(), 0);
/** google.protobuf.BoolValue as `boolean | null`. */
export const BoolValueCodec = wrapper("BoolValue", protojson.bool, V, (w, v) => w.bool(v), (r) => r.bool(), false);
/** google.protobuf.StringValue as `string | null`. */
export const StringValueCodec = wrapper("StringValue", protojson.string, WireType.LengthDelimited, (w, v) => w.string(v), (r) => r.string(), "");
/** google.protobuf.BytesValue as base64 `string | null`. */
export const BytesValueCodec = wrapper(
  "BytesValue",
  protojson.bytes,
  WireType.LengthDelimited,
  (w, v) => w.bytes(binary.bytesIn(v)),
  (r) => binary.bytesOut(r.bytes()),
  "",
);
