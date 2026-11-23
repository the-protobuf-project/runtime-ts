// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError } from "@the-protobuf-project/errors";
import type { JsonValue, MessageCodec } from "@the-protobuf-project/protobuf";
import type { CallContext, ConnectorMethod } from "./types.ts";

/** How much of a stream a sandbox call reads. */
export interface StreamOptions {
  /** Replies to read before the stream is cut short. Default 100, at most 1000. */
  limit?: number;
  /** Milliseconds to read for before the stream is cut short. Default 10000, at most 60000. */
  timeoutMs?: number;
}

/** What a server-streaming or bidi call returns to the sandbox. */
export interface StreamResult<T> {
  messages: T[];
  /** False when the stream was cut short by limit or timeoutMs, so it may have had more. */
  complete: boolean;
}

const defaultLimit = 100;
const maxLimit = 1000;
const defaultTimeoutMs = 10_000;
const maxTimeoutMs = 60_000;

/** Fields every streaming method's spec shares. */
interface StreamSpec<I, O> {
  name: string;
  input: MessageCodec<I>;
  output: MessageCodec<O>;
  requiresApproval: boolean;
  approvalMessage?: string;
}

/** A server-streaming RPC: one request, a stream of replies. */
export interface ServerStreamMethodSpec<I, O> extends StreamSpec<I, O> {
  call(request: I, context: CallContext): AsyncIterable<O>;
}

/** A client-streaming RPC: a stream of requests, one reply. */
export interface ClientStreamMethodSpec<I, O> extends StreamSpec<I, O> {
  call(requests: AsyncIterable<I>, context: CallContext): Promise<O>;
}

/** A bidi RPC: a stream of requests and a stream of replies. */
export interface BidiStreamMethodSpec<I, O> extends StreamSpec<I, O> {
  call(requests: AsyncIterable<I>, context: CallContext): AsyncIterable<O>;
}

/**
 * Wraps a server-streaming RPC as a sandbox method: `ns.watch(input, { limit, timeoutMs })`
 * returns `{ messages, complete }`. One sandbox call is one logged call, so replay returns
 * what the stream gave, and approval covers the whole stream.
 */
export function serverStreamMethod<I, O>(spec: ServerStreamMethodSpec<I, O>): ConnectorMethod {
  return method(spec, (args, context) => {
    const request = spec.input.fromJson(args ?? {}, spec.name);
    return read(spec, context, (c) => spec.call(request, c));
  });
}

/** Wraps a client-streaming RPC: `ns.upload([input, ...])` returns the one reply. */
export function clientStreamMethod<I, O>(spec: ClientStreamMethodSpec<I, O>): ConnectorMethod {
  return method(spec, async (args, context) => {
    const requests = messages(spec, args);
    return spec.output.toJson(await spec.call(each(requests), context), { emitDefaults: true });
  });
}

/**
 * Wraps a bidi RPC: `ns.chat([input, ...], { limit, timeoutMs })` sends every request and
 * returns `{ messages, complete }`. It is a batch, not a conversation: a script cannot send
 * a request chosen from a reply, which replay could not reproduce.
 */
export function bidiStreamMethod<I, O>(spec: BidiStreamMethodSpec<I, O>): ConnectorMethod {
  return method(spec, (args, context) => {
    const requests = messages(spec, args);
    return read(spec, context, (c) => spec.call(each(requests), c));
  });
}

function method<I, O>(
  spec: StreamSpec<I, O>,
  execute: (args: unknown, context: CallContext) => Promise<JsonValue>,
): ConnectorMethod {
  return {
    name: spec.name,
    requiresApproval: spec.requiresApproval,
    // A stream cannot be read again the same way, so a replay returns what it gave.
    replay: "log",
    ...(spec.approvalMessage ? { approvalMessage: spec.approvalMessage } : {}),
    execute,
  };
}

/** A client or bidi call's requests: an array of protojson messages. */
function messages<I, O>(spec: StreamSpec<I, O>, args: unknown): I[] {
  if (!Array.isArray(args)) {
    throw new StatusError("INVALID_ARGUMENT", `${spec.name} takes an array of requests`);
  }
  return args.map((m, i) => spec.input.fromJson(m ?? {}, `${spec.name}[${i}]`));
}

async function* each<I>(requests: readonly I[]): AsyncGenerator<I> {
  yield* requests;
}

/** Reads a stream of replies within its bounds, cancelling it when it is cut short. */
async function read<I, O>(
  spec: StreamSpec<I, O>,
  context: CallContext,
  open: (context: CallContext) => AsyncIterable<O>,
): Promise<JsonValue> {
  const { limit, timeoutMs } = bounds(spec.name, context.options);
  const controller = new AbortController();
  const stop = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", stop, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("the stream ran past timeoutMs", "TimeoutError"));
      resolve("timeout");
    }, timeoutMs);
  });

  const out: JsonValue[] = [];
  let complete = false;
  const iterator = open({ ...context, signal: controller.signal })[Symbol.asyncIterator]();
  try {
    while (out.length < limit) {
      // Raced, so a stream that ignores its signal still ends at the deadline.
      const next = await Promise.race([iterator.next(), deadline]);
      if (next === "timeout") break;
      if (next.done) {
        complete = true;
        break;
      }
      out.push(spec.output.toJson(next.value, { emitDefaults: true }));
    }
  } catch (e) {
    // Cut short by its own deadline: what arrived is the answer. Anything else is an error.
    if (!timedOut || context.signal?.aborted) throw e;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", stop);
    if (!complete) {
      controller.abort();
      void iterator.return?.()?.catch(() => undefined);
    }
  }
  return { messages: out, complete };
}

function bounds(name: string, options: unknown): { limit: number; timeoutMs: number } {
  const o = (options ?? {}) as Record<string, unknown>;
  const pick = (key: string, fallback: number, max: number): number => {
    const v = o[key];
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) {
      throw new StatusError("INVALID_ARGUMENT", `${name}: ${key} must be a whole number from 1 to ${max}`);
    }
    return v;
  };
  if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options))) {
    throw new StatusError("INVALID_ARGUMENT", `${name}: options must be { limit, timeoutMs }`);
  }
  return { limit: pick("limit", defaultLimit, maxLimit), timeoutMs: pick("timeoutMs", defaultTimeoutMs, maxTimeoutMs) };
}
