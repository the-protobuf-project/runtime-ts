// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { fromJsonString } from "../protobuf/binary.ts";
import { CodemodeError, toCodemodeError, type Code } from "../errors/index.ts";
import { BinaryReader } from "../protobuf/wire/reader.ts";
import type { CallOptions, MethodDescriptor } from "./types.ts";

/** A generated service descriptor: `<Service>Descriptor`. */
export interface ServiceDescriptor {
  readonly typeName: string;
  readonly methods: Readonly<Record<string, MethodDescriptor<any, any>>>;
}

/** An implementation of a generated service interface. */
export type ServiceImpl = Record<string, (request: any, options?: CallOptions) => Promise<unknown>>;

const status: Record<Code, number> = {
  CANCELLED: 499, UNKNOWN: 500, INVALID_ARGUMENT: 400, DEADLINE_EXCEEDED: 504, NOT_FOUND: 404,
  ALREADY_EXISTS: 409, PERMISSION_DENIED: 403, RESOURCE_EXHAUSTED: 429, FAILED_PRECONDITION: 400,
  ABORTED: 409, OUT_OF_RANGE: 400, UNIMPLEMENTED: 501, INTERNAL: 500, UNAVAILABLE: 503,
  DATA_LOSS: 500, UNAUTHENTICATED: 401,
};

/**
 * Serves service implementations over the Connect protocol's unary calls,
 * JSON or binary, as a fetch handler: hand it to Bun.serve, Deno.serve, a
 * Worker's fetch, or connectTransport's fetch option in tests.
 */
export function connectHandler(
  services: readonly { descriptor: ServiceDescriptor; impl: object }[],
): (request: Request) => Promise<Response> {
  const routes = new Map<string, { method: MethodDescriptor<any, any>; call: (r: unknown, o: CallOptions) => Promise<unknown> }>();
  for (const { descriptor, impl } of services) {
    for (const [key, method] of Object.entries(descriptor.methods)) {
      const fn = (impl as ServiceImpl)[key];
      if (fn) routes.set(`/${method.service}/${method.name}`, { method, call: fn.bind(impl) });
    }
  }
  return async (request) => {
    const route = routes.get(new URL(request.url).pathname);
    if (!route) return error(new CodemodeError("UNIMPLEMENTED", `no route for ${new URL(request.url).pathname}`));
    if (request.method !== "POST") return error(new CodemodeError("UNIMPLEMENTED", "Connect unary calls use POST"));
    const binary = (request.headers.get("content-type") ?? "").startsWith("application/proto");
    try {
      const input = binary
        ? route.method.input.decode(new BinaryReader(new Uint8Array(await request.arrayBuffer())))
        : fromJsonString(route.method.input, (await request.text()) || "{}");
      const output = await route.call(input, { signal: request.signal });
      if (binary) {
        const body = route.method.output.encode(output).finish() as Uint8Array<ArrayBuffer>;
        return new Response(body, { headers: { "content-type": "application/proto" } });
      }
      return Response.json(route.method.output.toJson(output));
    } catch (e) {
      return error(toCodemodeError(e));
    }
  };
}

function error(e: CodemodeError): Response {
  const body: Record<string, unknown> = { code: e.code.toLowerCase(), message: e.message };
  if (e.details) body["details"] = e.details;
  return Response.json(body, { status: status[e.code] });
}
