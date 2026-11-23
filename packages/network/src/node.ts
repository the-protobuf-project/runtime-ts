// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// Full-duplex HTTP/2 for Bun, Node and Deno, which fetch cannot do: what connectTransport
// needs for bidi streaming. Kept out of the main entry point so it never loads in
// browsers or Workers.

import { type ClientHttp2Session, connect, constants, type SecureClientSessionOptions } from "node:http2";
import type { Duplex, DuplexRequest, DuplexResponse } from "./types.ts";

/** Options for {@link http2Duplex}. */
export interface Http2DuplexOptions {
  /** TLS and session options for https:// origins, e.g. a CA for a private certificate. */
  connect?: SecureClientSessionOptions;
}

/** A {@link Duplex} that can also close its connections. */
export interface Http2Duplex extends Duplex {
  /** Closes every connection; calls in flight finish first. */
  close(): void;
}

/**
 * Makes full-duplex requests over HTTP/2: TLS (ALPN h2) for https:// URLs, cleartext
 * (h2c, prior knowledge) for http:// ones. One connection per origin is reused, and it
 * keeps the process alive only while a call is in flight.
 *
 * ```ts
 * const transport = connectTransport({ baseUrl, format: "binary", duplex: http2Duplex() });
 * for await (const reply of transport.bidiStream!(method, requests)) { ... }
 * ```
 */
export function http2Duplex(options: Http2DuplexOptions = {}): Http2Duplex {
  const sessions = new Map<string, { session: ClientHttp2Session; active: number }>();

  function session(origin: string): { session: ClientHttp2Session; active: number } {
    const open = sessions.get(origin);
    if (open && !open.session.closed && !open.session.destroyed) return open;
    const entry = { session: connect(origin, options.connect ?? {}), active: 0 };
    entry.session.on("error", () => sessions.delete(origin));
    entry.session.on("close", () => sessions.delete(origin));
    entry.session.unref();
    sessions.set(origin, entry);
    return entry;
  }

  return {
    request({ url, headers, body, signal }: DuplexRequest): Promise<DuplexResponse> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      const target = new URL(url);
      const entry = session(target.origin);
      if (entry.active++ === 0) entry.session.ref();
      const stream = entry.session.request({ ":method": "POST", ":path": target.pathname + target.search, ...headers });
      const abort = () => stream.close(constants.NGHTTP2_CANCEL);
      signal?.addEventListener("abort", abort, { once: true });
      const closed = new Promise<void>((resolve) => stream.once("close", resolve));
      void closed.then(() => {
        signal?.removeEventListener("abort", abort);
        if (--entry.active === 0) entry.session.unref();
      });

      // The request body is written while the response is read: that is the point. Once the
      // exchange closes, however it closes, the requests are no longer read.
      const requests = body[Symbol.asyncIterator]();
      void (async () => {
        while (true) {
          const next = await Promise.race([requests.next(), closed.then(() => undefined)]);
          if (next === undefined) break;
          if (next.done) return void stream.end();
          if (!stream.write(next.value)) {
            await Promise.race([new Promise((resolve) => stream.once("drain", resolve)), closed]);
          }
        }
        void requests.return?.();
      })().catch((err: unknown) => stream.destroy(err instanceof Error ? err : new Error(String(err))));

      return new Promise((resolve, reject) => {
        stream.once("error", reject);
        // A stream closed before its headers, by an abort or a reset, has no response.
        void closed.then(() =>
          reject(signal?.aborted ? signal.reason : new Error("the stream closed before a response")),
        );
        stream.once("response", (head) => {
          const out: Record<string, string> = {};
          for (const [key, value] of Object.entries(head)) {
            if (!key.startsWith(":") && value !== undefined)
              out[key] = Array.isArray(value) ? value.join(", ") : String(value);
          }
          resolve({ status: Number(head[":status"]), headers: out, body: bytes(stream) });
        });
      });
    },

    close() {
      for (const { session: s } of sessions.values()) s.close();
      sessions.clear();
    },
  };
}

/** The response stream's chunks as Uint8Array. */
async function* bytes(stream: AsyncIterable<unknown>): AsyncGenerator<Uint8Array> {
  for await (const chunk of stream) {
    yield chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
  }
}
