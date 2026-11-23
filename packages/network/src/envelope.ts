// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { codeFromConnect, StatusError } from "@the-protobuf-project/errors";

/** The message is compressed. */
export const COMPRESSED = 0x01;
/** The envelope is the stream's last: JSON with the error and trailers. */
export const END_STREAM = 0x02;

/** One Connect streaming envelope: a flags byte, a big-endian length, the data. */
export function envelope(flags: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, data.length);
  out.set(data, 5);
  return out;
}

/** Splits a byte stream into envelopes, however it was chunked. */
export async function* envelopes(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<{ flags: number; data: Uint8Array }> {
  let buf = new Uint8Array(0);
  for await (const chunk of chunks) {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf);
    next.set(chunk, buf.length);
    buf = next;
    while (buf.length >= 5) {
      const length = new DataView(buf.buffer, buf.byteOffset).getUint32(1);
      if (buf.length < 5 + length) break;
      yield { flags: buf[0] ?? 0, data: buf.slice(5, 5 + length) };
      buf = buf.slice(5 + length);
    }
  }
  if (buf.length > 0) throw new StatusError("INTERNAL", "the stream ended inside an envelope");
}

/**
 * Reads an end-stream envelope: {"error": {...}, "metadata": {...}}. Returns the call's
 * error, or undefined when it succeeded.
 */
export function endStreamError(data: Uint8Array): StatusError | undefined {
  let end: { error?: { code?: unknown; message?: unknown; details?: unknown } };
  try {
    end = JSON.parse(new TextDecoder().decode(data) || "{}");
  } catch {
    return new StatusError("INTERNAL", "the end-stream message is not JSON");
  }
  const error = end.error;
  if (!error || typeof error.code !== "string") return undefined;
  return new StatusError(codeFromConnect(error.code), typeof error.message === "string" ? error.message : error.code, {
    ...(Array.isArray(error.details) ? { details: error.details } : {}),
  });
}

/** Iterates a ReadableStream with a reader, which every runtime supports. */
export async function* chunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      yield value;
    }
  } finally {
    // A caller that stops reading stops the download, rather than leaving it running.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
