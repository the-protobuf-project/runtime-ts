// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, BinaryWriter, WireType, decodeBase64, encodeBase64 } from "../src/index.ts";

test("varints round-trip, including negatives and 64-bit values", () => {
  const w = new BinaryWriter();
  w.uint32(0).uint32(300).int32(-1).sint32(-2).int64("-9223372036854775808").uint64("18446744073709551615").sint64("-3");
  const r = new BinaryReader(w.finish());
  assert.equal(r.uint32(), 0);
  assert.equal(r.uint32(), 300);
  assert.equal(r.int32(), -1);
  assert.equal(r.sint32(), -2);
  assert.equal(r.int64(), "-9223372036854775808");
  assert.equal(r.uint64(), "18446744073709551615");
  assert.equal(r.sint64(), "-3");
  assert.equal(r.pos, r.len);
});

test("negative int32 takes ten bytes, as protobuf requires", () => {
  assert.equal(new BinaryWriter().int32(-1).finish().length, 10);
});

test("fixed-width and floating values round-trip", () => {
  const w = new BinaryWriter().fixed32(4294967295).sfixed32(-5).fixed64("123").sfixed64("-123").float(1.5).double(Math.PI).bool(true);
  const r = new BinaryReader(w.finish());
  assert.equal(r.fixed32(), 4294967295);
  assert.equal(r.sfixed32(), -5);
  assert.equal(r.fixed64(), "123");
  assert.equal(r.sfixed64(), "-123");
  assert.equal(r.float(), 1.5);
  assert.equal(r.double(), Math.PI);
  assert.equal(r.bool(), true);
});

test("fork and join nest length-delimited sections", () => {
  const w = new BinaryWriter();
  w.tag(1, WireType.LengthDelimited).fork().tag(2, WireType.LengthDelimited).string("héllo").join();
  w.tag(3, WireType.Varint).uint32(7);
  const r = new BinaryReader(w.finish());
  assert.deepEqual(r.tag(), [1, WireType.LengthDelimited]);
  const end = r.uint32() + r.pos;
  assert.deepEqual(r.tag(), [2, WireType.LengthDelimited]);
  assert.equal(r.string(), "héllo");
  assert.equal(r.pos, end);
  assert.deepEqual(r.tag(), [3, WireType.Varint]);
  assert.equal(r.uint32(), 7);
});

test("skip passes over every wire type", () => {
  const w = new BinaryWriter()
    .tag(1, WireType.Varint).uint32(1)
    .tag(2, WireType.Fixed64).double(1)
    .tag(3, WireType.LengthDelimited).string("x")
    .tag(4, WireType.Fixed32).float(1)
    .tag(5, WireType.Varint).uint32(42);
  const r = new BinaryReader(w.finish());
  for (let i = 0; i < 4; i++) {
    const [no, wt] = r.tag();
    r.skip(wt, no);
  }
  assert.deepEqual(r.tag(), [5, WireType.Varint]);
  assert.equal(r.uint32(), 42);
});

test("truncated input fails with DATA_LOSS", () => {
  const bytes = new BinaryWriter().tag(1, WireType.LengthDelimited).string("hello").finish();
  const r = new BinaryReader(bytes.subarray(0, 4));
  r.tag();
  assert.throws(() => r.string(), { code: "DATA_LOSS" });
});

test("base64 accepts standard and URL-safe alphabets, padded or not", () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0x00, 0x10]);
  assert.equal(encodeBase64(bytes), "+/8AEA==");
  assert.deepEqual(decodeBase64("+/8AEA=="), bytes);
  assert.deepEqual(decodeBase64("-_8AEA"), bytes);
  assert.equal(decodeBase64("not base64!"), undefined);
});
