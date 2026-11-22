// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** A size budget. maxChars wins over maxTokens. */
export interface TruncateOptions {
  maxChars?: number;
  /** Estimated at four characters per token. Defaults to 6,000. */
  maxTokens?: number;
}

const marker = "\n--- TRUNCATED ---";

function budget(options: TruncateOptions): number {
  return options.maxChars ?? (options.maxTokens ?? 6000) * 4;
}

/** Cuts text to the budget, marking where it was cut. */
export function truncateText(text: string, options: TruncateOptions = {}): string {
  const max = budget(options);
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - marker.length)) + marker;
}

/**
 * Returns value unchanged when its JSON fits the budget, or the truncated
 * JSON text when it does not.
 */
export function truncateResult(value: unknown, options: TruncateOptions = {}): unknown {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  if (text.length <= budget(options)) return value;
  return truncateText(text, options);
}
