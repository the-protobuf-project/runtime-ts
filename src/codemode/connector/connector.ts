// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { MessageCodec } from "../../protobuf/types.ts";
import type { CallContext, Connector, ConnectorMethod, ConnectorOptions, Replay } from "./types.ts";

/** A typed unary method, before it is wrapped for protojson. */
export interface UnaryMethodSpec<I, O> {
  name: string;
  input: MessageCodec<I>;
  output: MessageCodec<O>;
  requiresApproval: boolean;
  replay: Replay;
  approvalMessage?: string;
  call(request: I, context: CallContext): Promise<O>;
  revert?(request: I, response: O, context: CallContext): Promise<void>;
}

/** Wraps a typed method so the sandbox can call it with protojson. */
export function unaryMethod<I, O>(spec: UnaryMethodSpec<I, O>): ConnectorMethod {
  const method: ConnectorMethod = {
    name: spec.name,
    requiresApproval: spec.requiresApproval,
    replay: spec.replay,
    ...(spec.approvalMessage ? { approvalMessage: spec.approvalMessage } : {}),
    async execute(args, context) {
      const request = spec.input.fromJson(args ?? {}, spec.name);
      return spec.output.toJson(await spec.call(request, context), { emitDefaults: true });
    },
  };
  const revert = spec.revert;
  if (revert) {
    method.revert = (args, result, context) =>
      revert(spec.input.fromJson(args ?? {}, spec.name), spec.output.fromJson(result ?? {}, spec.name), context);
  }
  return method;
}

/** The generated description of a connector. */
export interface ConnectorSpec {
  namespace: string;
  instructions?: string;
  methods: ConnectorMethod[];
}

/** Builds a connector, applying deployment options. */
export function connector(spec: ConnectorSpec, options: ConnectorOptions = {}): Connector {
  const methods: Record<string, ConnectorMethod> = {};
  for (const m of spec.methods) {
    if (options.exclude?.includes(m.name)) continue;
    const forced = options.approval?.[m.name];
    if (forced === undefined || forced === m.requiresApproval) {
      methods[m.name] = m;
      continue;
    }
    const replay: Replay = forced ? "log" : m.replay;
    methods[m.name] = { ...m, requiresApproval: forced, replay };
  }
  const out: Connector = { namespace: options.namespace ?? spec.namespace, methods };
  return spec.instructions ? { ...out, instructions: spec.instructions } : out;
}
