// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** Words of a spec name: "HoldService_CreateHold" is Hold, Service, Create, Hold. */
function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** PascalCase, for type names. */
export function pascal(value: string): string {
  return words(value)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** lowerCamel, for method names. */
export function camel(value: string): string {
  const p = pascal(value);
  const name = p.charAt(0).toLowerCase() + p.slice(1);
  return /^[a-z]/.test(name) ? name : `op${p}`;
}

// Globals of the sandbox, and words that cannot be declared as a constant.
const reserved = new Set(
  `arguments await break case catch class codemode console const continue debugger default delete do else enum eval
   export extends false fetch finally for function globalThis if implements import in instanceof interface let new null
   package private protected public return static super switch this throw true try typeof undefined var void while with
   yield`.split(/\s+/),
);

/** Reports whether a name can be a sandbox global. */
export function validNamespace(name: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(name) && !reserved.has(name) && !(name in Object.prototype);
}

/** An object key as TypeScript. */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * A JSDoc block at indent, or "" when there is nothing to say. Spec text is untrusted: it
 * cannot close the comment and so cannot add declarations of its own.
 */
export function jsdoc(indent: string, ...paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => p.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("*/", "*\\/");
  if (!body) return "";
  if (!body.includes("\n")) return `${indent}/** ${body} */\n`;
  const lines = body.split("\n").map((line) => `${indent} * ${line}`.trimEnd());
  return `${indent}/**\n${lines.join("\n")}\n${indent} */\n`;
}
