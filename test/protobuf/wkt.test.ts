// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnyCodec, DurationCodec, FieldMaskCodec, Int64ValueCodec, StringValueCodec, StructCodec, TimestampCodec, ValueCodec,
  fromBinary, protojson, registerTypes, toBinary, type MessageCodec,
} from "../../src/protobuf/index.ts";

function roundTrip<T>(codec: MessageCodec<T>, value: T): T {
  return fromBinary(codec, toBinary(codec, value));
}

test("Timestamp normalises offsets and keeps nanos", () => {
  assert.equal(TimestampCodec.fromJson("2026-11-22T12:00:00+02:00"), "2026-11-22T10:00:00Z");
  assert.equal(roundTrip(TimestampCodec, "2026-11-22T10:00:00.123456789Z"), "2026-11-22T10:00:00.123456789Z");
  assert.equal(roundTrip(TimestampCodec, "2026-11-22T10:00:00.500Z"), "2026-11-22T10:00:00.500Z");
  assert.throws(() => TimestampCodec.fromJson("yesterday"), { code: "INVALID_ARGUMENT" });
});

test("Duration handles fractions and negatives", () => {
  assert.equal(roundTrip(DurationCodec, "1.5s"), "1.500s");
  assert.equal(roundTrip(DurationCodec, "-0.25s"), "-0.250s");
  assert.equal(roundTrip(DurationCodec, "3600s"), "3600s");
  assert.throws(() => DurationCodec.fromJson("1h"), { code: "INVALID_ARGUMENT" });
});

test("FieldMask converts between lowerCamel JSON and snake_case binary", () => {
  const bytes = toBinary(FieldMaskCodec, "displayName,book.pageCount");
  assert.ok(new TextDecoder().decode(bytes).includes("display_name"));
  assert.equal(fromBinary(FieldMaskCodec, bytes), "displayName,book.pageCount");
});

test("Struct and Value round-trip nested JSON", () => {
  const value = { a: 1, b: "two", c: [true, null, { d: 4.5 }] };
  assert.deepEqual(roundTrip(StructCodec, value), value);
  assert.equal(roundTrip(ValueCodec, null), null);
  assert.throws(() => ValueCodec.fromJson(Number.NaN), { code: "INVALID_ARGUMENT" });
});

test("wrappers carry null for unset", () => {
  assert.equal(StringValueCodec.fromJson(null), null);
  assert.equal(roundTrip(StringValueCodec, "x"), "x");
  assert.equal(Int64ValueCodec.fromJson(42), "42");
});

test("Any packs registered types, nesting well-known ones under value", () => {
  registerTypes([TimestampCodec]);
  const ts = { "@type": "type.googleapis.com/google.protobuf.Timestamp", value: "2026-01-01T00:00:00Z" };
  assert.deepEqual(roundTrip(AnyCodec, ts), ts);
  assert.throws(() => toBinary(AnyCodec, { "@type": "type.googleapis.com/unknown.Type" }), { code: "INVALID_ARGUMENT" });
});

test("protojson readers validate and report the path", () => {
  assert.equal(protojson.int64("12", "f"), "12");
  assert.equal(protojson.int64(12, "f"), "12");
  assert.throws(() => protojson.int32(1.5, "book.pages"), /book\.pages/);
  assert.throws(() => protojson.uint64("-1", "f"), { code: "INVALID_ARGUMENT" });
  assert.equal(protojson.float("NaN", "f"), Number.NaN);
  assert.equal(protojson.floatOut(Number.POSITIVE_INFINITY), "Infinity");
  assert.equal(protojson.get({ display_name: "x" }, "displayName", "display_name"), "x");
  assert.throws(() => protojson.oneof({ a: "1", b: "2" }, "m", "pick", ["a", "b"]), /oneof pick/);
});
