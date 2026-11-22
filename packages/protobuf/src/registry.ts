// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import type { MessageCodec } from "./types.ts";

const types = new Map<string, MessageCodec<unknown>>();

/**
 * Registers message codecs by type name so google.protobuf.Any can pack and
 * unpack them. Generated packages register their codecs on import.
 */
export function registerTypes(codecs: readonly MessageCodec<any>[]): void {
  for (const codec of codecs) types.set(codec.typeName, codec as MessageCodec<unknown>);
}

/** Finds a registered codec by fully qualified type name. */
export function lookupType(typeName: string): MessageCodec<unknown> | undefined {
  return types.get(typeName);
}
