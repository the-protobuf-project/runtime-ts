// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import { WireType } from "./writer.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Reads the protobuf binary format. 64-bit integers come back as strings. */
export class BinaryReader {
  readonly buf: Uint8Array;
  readonly len: number;
  pos = 0;
  private readonly view: DataView;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.len = buf.length;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Reads a field tag as [field number, wire type]. */
  tag(): [number, WireType] {
    const t = this.uint32();
    const fieldNo = t >>> 3;
    const wireType = (t & 7) as WireType;
    if (fieldNo <= 0 || wireType > 5) throw corrupt(`illegal tag ${t}`);
    return [fieldNo, wireType];
  }

  uint32(): number {
    return Number(BigInt.asUintN(32, this.varint64()));
  }

  int32(): number {
    return Number(BigInt.asIntN(32, this.varint64()));
  }

  sint32(): number {
    const v = this.uint32();
    return (v >>> 1) ^ -(v & 1);
  }

  fixed32(): number {
    return this.view.getUint32(this.advance(4), true);
  }

  sfixed32(): number {
    return this.view.getInt32(this.advance(4), true);
  }

  float(): number {
    return this.view.getFloat32(this.advance(4), true);
  }

  double(): number {
    return this.view.getFloat64(this.advance(8), true);
  }

  bool(): boolean {
    return this.varint64() !== 0n;
  }

  int64(): string {
    return BigInt.asIntN(64, this.varint64()).toString();
  }

  uint64(): string {
    return this.varint64().toString();
  }

  sint64(): string {
    const v = this.varint64();
    return ((v >> 1n) ^ -(v & 1n)).toString();
  }

  fixed64(): string {
    return this.view.getBigUint64(this.advance(8), true).toString();
  }

  sfixed64(): string {
    return this.view.getBigInt64(this.advance(8), true).toString();
  }

  string(): string {
    return decoder.decode(this.bytes());
  }

  bytes(): Uint8Array {
    const n = this.uint32();
    const at = this.advance(n);
    return this.buf.subarray(at, at + n);
  }

  /** Skips one field of the given wire type. */
  skip(wireType: WireType, fieldNo?: number): void {
    switch (wireType) {
      case WireType.Varint:
        this.varint64();
        return;
      case WireType.Fixed64:
        this.advance(8);
        return;
      case WireType.LengthDelimited:
        this.advance(this.uint32());
        return;
      case WireType.Fixed32:
        this.advance(4);
        return;
      case WireType.StartGroup:
        for (;;) {
          const [no, wt] = this.tag();
          if (wt === WireType.EndGroup) {
            if (fieldNo !== undefined && no !== fieldNo) throw corrupt("mismatched end group");
            return;
          }
          this.skip(wt, no);
        }
      default:
        throw corrupt(`cannot skip wire type ${wireType}`);
    }
  }

  /** Returns the end offset of a length-delimited section starting here. */
  end(length?: number): number {
    return length === undefined ? this.len : this.pos + length;
  }

  private varint64(): bigint {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.pos >= this.len) throw corrupt("truncated varint");
      const b = this.buf[this.pos++] as number;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return BigInt.asUintN(64, result);
    }
    throw corrupt("varint longer than 10 bytes");
  }

  private advance(n: number): number {
    const at = this.pos;
    if (at + n > this.len) throw corrupt("truncated message");
    this.pos += n;
    return at;
  }
}

function corrupt(message: string): StatusError {
  return new StatusError("DATA_LOSS", `protobuf: ${message}`);
}
