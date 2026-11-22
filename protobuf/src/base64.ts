// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const lookup = new Map<string, number>();
for (let i = 0; i < alphabet.length; i++) lookup.set(alphabet[i] as string, i);
lookup.set("-", 62);
lookup.set("_", 63);

/** Encodes bytes as standard, padded base64, as protojson writes them. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : alphabet[c & 63];
  }
  return out;
}

/**
 * Decodes standard or URL-safe base64, padded or not, as protojson accepts.
 * Returns undefined for input that is not base64.
 */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const ch of clean) {
    const v = lookup.get(ch);
    if (v === undefined) return undefined;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}
