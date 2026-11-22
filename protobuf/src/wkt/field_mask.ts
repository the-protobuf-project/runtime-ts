// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { MessageCodec } from "../types.ts";
import { invalid } from "@the-protobuf-project/errors";
import { BinaryReader } from "../wire/reader.ts";
import { BinaryWriter, WireType } from "../wire/writer.ts";

function toSnake(path: string): string {
  return path.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toCamel(path: string): string {
  return path.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function paths(mask: string): string[] {
  return mask === "" ? [] : mask.split(",").map((p) => p.trim());
}

/** google.protobuf.FieldMask as comma-separated lowerCamel paths, e.g. "title,author.name". */
export const FieldMaskCodec: MessageCodec<string> = {
  typeName: "google.protobuf.FieldMask",
  fromJson(json, path = "google.protobuf.FieldMask") {
    if (typeof json !== "string") return invalid(path, `expected a string, got ${JSON.stringify(json)}`);
    return paths(json).map(toCamel).join(",");
  },
  toJson: (message) => message,
  encode(message, writer = new BinaryWriter()) {
    for (const p of paths(message)) writer.tag(1, WireType.LengthDelimited).string(toSnake(p));
    return writer;
  },
  decode(input, length) {
    const r = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = r.end(length);
    const out: string[] = [];
    while (r.pos < end) {
      const [no, wt] = r.tag();
      if (no === 1) out.push(toCamel(r.string()));
      else r.skip(wt, no);
    }
    return out.join(",");
  },
};
