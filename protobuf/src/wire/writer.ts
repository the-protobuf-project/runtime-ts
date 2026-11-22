// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** Protobuf wire types. */
export const WireType = {
  Varint: 0,
  Fixed64: 1,
  LengthDelimited: 2,
  StartGroup: 3,
  EndGroup: 4,
  Fixed32: 5,
} as const;

/** A protobuf wire type number. */
export type WireType = (typeof WireType)[keyof typeof WireType];

const encoder = new TextEncoder();

/** Accepted inputs for 64-bit integer fields. protojson carries them as strings. */
export type Int64Input = string | number | bigint;

/** Writes the protobuf binary format. Nested messages use fork() and join(). */
export class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private buf: number[] = [];
  private stack: { chunks: Uint8Array[]; buf: number[] }[] = [];

  /** Writes a field tag. */
  tag(fieldNo: number, wireType: WireType): this {
    return this.uint32(((fieldNo << 3) | wireType) >>> 0);
  }

  uint32(value: number): this {
    let v = value >>> 0;
    while (v > 0x7f) {
      this.buf.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.buf.push(v);
    return this;
  }

  int32(value: number): this {
    return value < 0 ? this.varint64(BigInt.asUintN(64, BigInt(value))) : this.uint32(value);
  }

  sint32(value: number): this {
    return this.uint32(((value << 1) ^ (value >> 31)) >>> 0);
  }

  fixed32(value: number): this {
    const v = value >>> 0;
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24);
    return this;
  }

  sfixed32(value: number): this {
    return this.fixed32(value | 0);
  }

  float(value: number): this {
    return this.raw(8, 4, (view) => view.setFloat32(0, value, true));
  }

  double(value: number): this {
    return this.raw(8, 8, (view) => view.setFloat64(0, value, true));
  }

  bool(value: boolean): this {
    this.buf.push(value ? 1 : 0);
    return this;
  }

  int64(value: Int64Input): this {
    return this.varint64(BigInt.asUintN(64, BigInt(value)));
  }

  uint64(value: Int64Input): this {
    return this.varint64(BigInt.asUintN(64, BigInt(value)));
  }

  sint64(value: Int64Input): this {
    const v = BigInt.asIntN(64, BigInt(value));
    return this.varint64(BigInt.asUintN(64, (v << 1n) ^ (v >> 63n)));
  }

  fixed64(value: Int64Input): this {
    return this.raw(8, 8, (view) => view.setBigUint64(0, BigInt.asUintN(64, BigInt(value)), true));
  }

  sfixed64(value: Int64Input): this {
    return this.raw(8, 8, (view) => view.setBigInt64(0, BigInt.asIntN(64, BigInt(value)), true));
  }

  string(value: string): this {
    return this.bytes(encoder.encode(value));
  }

  bytes(value: Uint8Array): this {
    this.uint32(value.length);
    this.flush();
    this.chunks.push(value);
    return this;
  }

  /** Starts a length-delimited section; close it with join(). */
  fork(): this {
    this.stack.push({ chunks: this.chunks, buf: this.buf });
    this.chunks = [];
    this.buf = [];
    return this;
  }

  /** Closes the section fork() opened, prefixing it with its length. */
  join(): this {
    const inner = this.finish();
    const outer = this.stack.pop();
    if (!outer) throw new Error("BinaryWriter.join() without fork()");
    this.chunks = outer.chunks;
    this.buf = outer.buf;
    return this.bytes(inner);
  }

  /** Returns the bytes written so far. */
  finish(): Uint8Array {
    this.flush();
    let size = 0;
    for (const c of this.chunks) size += c.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.chunks = [out];
    return out;
  }

  private varint64(value: bigint): this {
    let v = value;
    while (v > 0x7fn) {
      this.buf.push(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.buf.push(Number(v));
    return this;
  }

  private raw(_align: number, size: number, set: (view: DataView) => void): this {
    const bytes = new Uint8Array(size);
    set(new DataView(bytes.buffer));
    for (const b of bytes) this.buf.push(b);
    return this;
  }

  private flush(): void {
    if (this.buf.length > 0) {
      this.chunks.push(Uint8Array.from(this.buf));
      this.buf = [];
    }
  }
}
