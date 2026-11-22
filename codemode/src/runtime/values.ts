// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { StatusError, isCode, toStatusError } from "@the-protobuf-project/errors";
import type { SerializedError } from "./types.ts";

/** The largest value, as JSON characters, the runtime records for replay. */
export const MAX_DURABLE_VALUE_BYTES = 1_000_000;

/** The default time a paused execution waits before it expires: 24 hours. */
export const DEFAULT_PAUSED_TTL_MS = 86_400_000;

/** The default number of finished executions kept. */
export const DEFAULT_MAX_EXECUTIONS = 50;

/** JSON with object keys sorted, so equal values compare equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  }) ?? "null";
}

/** Throws RESOURCE_EXHAUSTED when a value is too large to record. */
export function checkSize(what: string, value: unknown, max: number): void {
  const size = (JSON.stringify(value) ?? "").length;
  if (size > max) {
    throw new StatusError("RESOURCE_EXHAUSTED", `${what} is ${size} characters of JSON; the limit is ${max}`);
  }
}

/** Converts any thrown value to the form stored in logs and sent to the sandbox. */
export function serializeError(error: unknown): SerializedError {
  const e = toStatusError(error);
  const out: SerializedError = { code: e.code, message: e.message };
  if (e.reason !== undefined) out.reason = e.reason;
  if (e.details !== undefined) out.details = e.details;
  return out;
}

/** Rebuilds a StatusError from its stored form. */
export function deserializeError(e: SerializedError): StatusError {
  return new StatusError(isCode(e.code) ? e.code : "UNKNOWN", e.message, {
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    ...(e.details !== undefined ? { details: e.details } : {}),
  });
}
