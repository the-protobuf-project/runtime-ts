// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { JsonValue } from "../../protobuf/types.ts";

/** What a replayed call does: return its logged result, or run again. */
export type Replay = "log" | "reexecute";

/** Context passed to every connector call. */
export interface CallContext {
  /** The execution making the call. */
  executionId: string;
  /** Aborted when the pass times out or is cancelled. */
  signal?: AbortSignal;
}

/**
 * One sandbox method. Arguments and results are protojson: the method
 * validates arguments with its input codec before anything runs.
 */
export interface ConnectorMethod {
  /** Method name inside the namespace, e.g. "createBook". */
  readonly name: string;
  /** Whether a call pauses until a person approves it. */
  readonly requiresApproval: boolean;
  readonly replay: Replay;
  /** Shown to the person asked to approve a call. */
  readonly approvalMessage?: string;
  execute(args: unknown, context: CallContext): Promise<JsonValue>;
  /** Undoes an applied call during rollback. */
  revert?(args: unknown, result: unknown, context: CallContext): Promise<void>;
}

/** A namespace of methods the sandbox can call, e.g. `library`. */
export interface Connector {
  readonly namespace: string;
  readonly instructions?: string;
  readonly methods: Readonly<Record<string, ConnectorMethod>>;
}

/** Deployment-time adjustments to a generated connector. */
export interface ConnectorOptions {
  /** Expose the service under another sandbox global. */
  namespace?: string;
  /** Force approval on (true) or off (false) per method name. */
  approval?: Record<string, boolean>;
  /** Hide methods by name. */
  exclude?: string[];
}
