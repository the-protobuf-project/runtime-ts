// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { transform } from "sucrase";
import { StatusError } from "@the-protobuf-project/runtime-ts/errors";

const fence = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```\s*$/;
const functionStart = /^(async\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|async\s+function\b|\(\s*async\b)/;

/**
 * Turns what a model wrote into one async function expression:
 * strips a Markdown fence, strips TypeScript types, and wraps a bare
 * statement list as `async () => { ... }`.
 */
export function normalizeCode(code: string): string {
  let src = code.trim();
  const fenced = fence.exec(src);
  if (fenced) src = (fenced[1] as string).trim();
  if (src === "") throw new StatusError("INVALID_ARGUMENT", "code is empty");

  src = stripTypes(src);
  src = src.trim().replace(/;+\s*$/, "");
  if (functionStart.test(src)) return src;
  return `async () => {\n${src}\n}`;
}

function stripTypes(src: string): string {
  try {
    return transform(src, { transforms: ["typescript"], disableESTransforms: true, keepUnusedImports: true }).code;
  } catch {
    // Not valid TypeScript: a bare function body with top-level return or
    // await. Strip types from it wrapped in a function, then unwrap.
    try {
      const wrapped = transform(`async () => {\n${src}\n}`, { transforms: ["typescript"], disableESTransforms: true }).code;
      const inner = /^async \(\) => \{\n([\s\S]*)\n\}\s*;?\s*$/.exec(wrapped.trim());
      return inner ? (inner[1] as string) : src;
    } catch (e) {
      throw new StatusError("INVALID_ARGUMENT", `code does not parse: ${(e as Error).message}`);
    }
  }
}
