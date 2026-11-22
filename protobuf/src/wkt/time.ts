// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { MessageCodec } from "../types.ts";
import { invalid } from "@the-protobuf-project/errors";
import { BinaryReader } from "../wire/reader.ts";
import { BinaryWriter, WireType } from "../wire/writer.ts";

const rfc3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;
const durationText = /^(-)?(\d+)(?:\.(\d{1,9}))?s$/;

/** Seconds and nanos, the binary shape of Timestamp and Duration. */
interface SecondsNanos {
  seconds: bigint;
  nanos: number;
}

function fraction(nanos: number): string {
  if (nanos === 0) return "";
  const nine = String(nanos).padStart(9, "0");
  if (nine.endsWith("000000")) return `.${nine.slice(0, 3)}`;
  if (nine.endsWith("000")) return `.${nine.slice(0, 6)}`;
  return `.${nine}`;
}

function nanosOf(digits: string | undefined): number {
  return digits ? Number(digits.padEnd(9, "0")) : 0;
}

function parseTimestamp(text: string, path: string): SecondsNanos {
  const m = rfc3339.exec(text);
  if (!m) return invalid(path, `expected an RFC 3339 timestamp, got ${JSON.stringify(text)}`);
  const [, y, mo, d, h, mi, s, frac, zone] = m as unknown as string[];
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (zone && zone.toUpperCase() !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    ms -= sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60000;
  }
  return { seconds: BigInt(ms / 1000), nanos: nanosOf(frac) };
}

function formatTimestamp(v: SecondsNanos): string {
  const base = new Date(Number(v.seconds) * 1000).toISOString().slice(0, 19);
  return `${base}${fraction(v.nanos)}Z`;
}

function parseDuration(text: string, path: string): SecondsNanos {
  const m = durationText.exec(text);
  if (!m) return invalid(path, `expected a duration such as "1.5s", got ${JSON.stringify(text)}`);
  const sign = m[1] ? -1 : 1;
  return { seconds: BigInt(sign) * BigInt(m[2] as string), nanos: sign * nanosOf(m[3]) };
}

function formatDuration(v: SecondsNanos): string {
  const negative = v.seconds < 0n || v.nanos < 0;
  const secs = v.seconds < 0n ? -v.seconds : v.seconds;
  return `${negative ? "-" : ""}${secs}${fraction(Math.abs(v.nanos))}s`;
}

function encodeSecondsNanos(v: SecondsNanos, writer: BinaryWriter): BinaryWriter {
  if (v.seconds !== 0n) writer.tag(1, WireType.Varint).int64(v.seconds);
  if (v.nanos !== 0) writer.tag(2, WireType.Varint).int32(v.nanos);
  return writer;
}

function decodeSecondsNanos(input: Uint8Array | BinaryReader, length?: number): SecondsNanos {
  const r = input instanceof BinaryReader ? input : new BinaryReader(input);
  const end = r.end(length);
  const v: SecondsNanos = { seconds: 0n, nanos: 0 };
  while (r.pos < end) {
    const [no, wt] = r.tag();
    if (no === 1) v.seconds = BigInt(r.int64());
    else if (no === 2) v.nanos = r.int32();
    else r.skip(wt, no);
  }
  return v;
}

function stringCodec(
  typeName: string,
  parse: (text: string, path: string) => SecondsNanos,
  format: (v: SecondsNanos) => string,
): MessageCodec<string> {
  return {
    typeName,
    fromJson(json, path = typeName) {
      if (typeof json !== "string") return invalid(path, `expected a string, got ${JSON.stringify(json)}`);
      return format(parse(json, path));
    },
    toJson: (message) => message,
    encode: (message, writer = new BinaryWriter()) => encodeSecondsNanos(parse(message, typeName), writer),
    decode: (input, length) => format(decodeSecondsNanos(input, length)),
  };
}

/** google.protobuf.Timestamp as an RFC 3339 string, e.g. "2026-11-22T10:00:00Z". */
export const TimestampCodec = stringCodec("google.protobuf.Timestamp", parseTimestamp, formatTimestamp);

/** google.protobuf.Duration as seconds with an "s" suffix, e.g. "1.5s". */
export const DurationCodec = stringCodec("google.protobuf.Duration", parseDuration, formatDuration);
