// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// Protobuf messages in TypeScript: the binary wire format, protojson, the
// well-known types, enums, resource names and the type registry. Generated
// messages are built on these.

export { binary, fromBinary, fromJsonString, toBinary, toJsonString, type ValueReader } from "./binary.ts";
export { decodeBase64, encodeBase64 } from "./base64.ts";
export { enumCodec } from "./enum.ts";
export { protojson, type JsonReader } from "./protojson.ts";
export { resourceName, type ResourceName } from "./resource.ts";
export type { EnumCodec, JsonObject, JsonValue, MessageCodec, MessageOf, ToJsonOptions } from "./types.ts";
export { lookupType, registerTypes } from "./registry.ts";
export { BinaryReader } from "./wire/reader.ts";
export { BinaryWriter, WireType, type Int64Input } from "./wire/writer.ts";

export { AnyCodec, EmptyCodec, type AnyMessage, type Empty } from "./wkt/any.ts";
export { FieldMaskCodec } from "./wkt/field_mask.ts";
export { ListValueCodec, StructCodec, ValueCodec } from "./wkt/struct.ts";
export { DurationCodec, TimestampCodec } from "./wkt/time.ts";
export {
  BoolValueCodec, BytesValueCodec, DoubleValueCodec, FloatValueCodec, Int32ValueCodec,
  Int64ValueCodec, StringValueCodec, UInt32ValueCodec, UInt64ValueCodec,
} from "./wkt/wrappers.ts";
