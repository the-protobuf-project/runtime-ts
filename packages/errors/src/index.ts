// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** gRPC status codes, as names. Sandboxed code branches on these. */
export type Code =
  | "CANCELLED"
  | "UNKNOWN"
  | "INVALID_ARGUMENT"
  | "DEADLINE_EXCEEDED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "RESOURCE_EXHAUSTED"
  | "FAILED_PRECONDITION"
  | "ABORTED"
  | "OUT_OF_RANGE"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "DATA_LOSS"
  | "UNAUTHENTICATED";

const codes: readonly Code[] = [
  "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND",
  "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION",
  "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS",
  "UNAUTHENTICATED",
];

/** Options for a StatusError beyond its code and message. */
export interface StatusErrorOptions {
  /** google.rpc.ErrorInfo reason, when the server sent one. */
  reason?: string;
  /** google.rpc.Status details, as protojson. */
  details?: unknown[];
  cause?: unknown;
}

/** An error carrying a gRPC status code; every client call and connector rejects with one. */
export class StatusError extends Error {
  readonly code: Code;
  readonly reason: string | undefined;
  readonly details: unknown[] | undefined;

  constructor(code: Code, message: string, options: StatusErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "StatusError";
    this.code = code;
    this.reason = options.reason;
    this.details = options.details;
  }

  toJSON(): { code: Code; message: string; reason?: string; details?: unknown[] } {
    const out: { code: Code; message: string; reason?: string; details?: unknown[] } = {
      code: this.code,
      message: this.message,
    };
    if (this.reason !== undefined) out.reason = this.reason;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

/** Reports whether value names a gRPC status code. */
export function isCode(value: unknown): value is Code {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

/** Maps a numeric gRPC code (1-16) to its name. */
export function codeFromNumber(value: number): Code {
  return codes[value - 1] ?? "UNKNOWN";
}

/** Maps a Connect protocol code ("invalid_argument") to its name. */
export function codeFromConnect(value: string): Code {
  const upper = value.toUpperCase();
  return isCode(upper) ? upper : "UNKNOWN";
}

/** Maps an HTTP status to the gRPC code google.api.http transcoding uses. */
export function codeFromHttpStatus(status: number): Code {
  switch (status) {
    case 400: return "INVALID_ARGUMENT";
    case 401: return "UNAUTHENTICATED";
    case 403: return "PERMISSION_DENIED";
    case 404: return "NOT_FOUND";
    case 409: return "ABORTED";
    case 412: return "FAILED_PRECONDITION";
    case 429: return "RESOURCE_EXHAUSTED";
    case 499: return "CANCELLED";
    case 501: return "UNIMPLEMENTED";
    case 503: return "UNAVAILABLE";
    case 504: return "DEADLINE_EXCEEDED";
    default: return status >= 500 ? "INTERNAL" : "UNKNOWN";
  }
}

/** Wraps any thrown value as a StatusError, keeping one that already is. */
export function toStatusError(error: unknown): StatusError {
  if (error instanceof StatusError) return error;
  if (error instanceof Error) return new StatusError("UNKNOWN", error.message, { cause: error });
  return new StatusError("UNKNOWN", String(error));
}

/** Throws INVALID_ARGUMENT with a path-qualified message. */
export function invalid(path: string, message: string): never {
  throw new StatusError("INVALID_ARGUMENT", `${path}: ${message}`);
}
