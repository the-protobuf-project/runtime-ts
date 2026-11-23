// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

/** What the sandbox defines before the model's code runs. */
export interface SandboxSpec {
  /** Namespace name to its method names. */
  namespaces: Record<string, readonly string[]>;
  /** Snippet name to its code, an async function of one input. */
  snippets: Record<string, string>;
  /** Define fetch(), routed through the host's allowlist and recorded as a step. */
  outbound?: boolean;
}

const fetchShim = `
globalThis.fetch = async (url, init = {}) => {
  const req = { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null };
  const r = await codemode.step("fetch " + req.method + " " + req.url, () => __call("fetch", req));
  return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers, text: async () => r.body, json: async () => JSON.parse(r.body) };
};
`;

/**
 * The sandbox side of the bridge, as JavaScript source. It expects a global
 * `__host(op, payload)` returning a promise of a JSON envelope, and defines
 * the namespaces, the `codemode` global and `console`.
 */
function prelude(spec: SandboxSpec): string {
  const namespaces = JSON.stringify(spec.namespaces);
  const snippets = Object.entries(spec.snippets)
    .map(([name, code]) => `${JSON.stringify(name)}: (${code})`)
    .join(",\n");
  return `
const __error = (e) => {
  const err = new Error(e.message);
  err.name = "CodemodeError";
  err.code = e.code;
  if (e.reason !== undefined) err.reason = e.reason;
  if (e.details !== undefined) err.details = e.details;
  return err;
};
const __call = async (op, payload) => {
  const out = JSON.parse(await __host(op, JSON.stringify(payload)));
  if (out.error) throw __error(out.error);
  return out.value;
};
const __namespace = (name, methods) => {
  const target = {};
  for (const m of methods) target[m] = (input, options) => __call("call", { path: name + "." + m, args: input === undefined ? {} : input, ...(options === undefined ? {} : { options }) });
  return new Proxy(Object.freeze(target), {
    get(t, key) {
      if (typeof key === "string" && !(key in t) && key !== "then") {
        throw __error({ code: "NOT_FOUND", message: name + "." + key + " is not a method; use codemode.search() to find one" });
      }
      return t[key];
    },
  });
};
for (const [name, methods] of Object.entries(${namespaces})) globalThis[name] = __namespace(name, methods);
const __snippets = {
${snippets}
};
const __format = (args) => args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
const __log = (level) => (...args) => { __host("log", JSON.stringify({ level, text: __format(args) })); };
globalThis.console = { log: __log("log"), info: __log("info"), warn: __log("warn"), error: __log("error"), debug: __log("debug") };
globalThis.codemode = Object.freeze({
  search: (query) => __call("search", { query: String(query) }),
  describe: (target) => __call("describe", { target: String(target) }),
  step: async (name, fn) => {
    const got = await __call("step", { name: String(name) });
    if (got.hit) return got.value;
    const value = await fn();
    await __call("step.put", { seq: got.seq, name: String(name), value: value === undefined ? null : value });
    return value;
  },
  run: async (name, input) => {
    const fn = __snippets[name];
    if (!fn) throw __error({ code: "NOT_FOUND", message: "no snippet named " + name });
    return await fn(input);
  },
});
`;
}

/**
 * Builds the script one pass evaluates: the prelude, then the model's code,
 * an async function expression. The script ends by assigning
 * `globalThis.__result` a promise of `{"ok":true,"value":...}` or
 * `{"ok":false,"error":{...}}` as a string; evaluated as a script, that
 * assignment is also its completion value.
 */
export function buildScript(spec: SandboxSpec, fn: string): string {
  return `${prelude(spec)}${spec.outbound ? fetchShim : ""}
globalThis.__result = (async () => {
  try {
    const __fn = (${fn}
);
    const value = await __fn();
    return JSON.stringify({ ok: true, value });
  } catch (e) {
    const error = e instanceof Error
      ? { name: e.name, message: e.message, code: e.code, reason: e.reason, details: e.details }
      : { name: "Error", message: String(e) };
    return JSON.stringify({ ok: false, error });
  }
})()`;
}
