// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { CodemodeRuntime } from "./runtime.ts";
import type { CodemodeOptions } from "./state.ts";

export type { CodemodeOptions } from "./state.ts";

/**
 * Creates the Code Mode runtime.
 *
 * ```ts
 * import { createCodemode } from "@the-protobuf-project/runtime/codemode";
 * import { QuickJSExecutor } from "@the-protobuf-project/runtime/codemode/quickjs";
 * import { catalog, config, connectors } from "./gen/index.ts";
 *
 * const runtime = createCodemode({
 *   catalog,
 *   config,
 *   connectors: connectors({ library: new LibraryServiceClient(transport) }),
 *   executor: new QuickJSExecutor(),
 * });
 * ```
 */
export function createCodemode(options: CodemodeOptions): CodemodeRuntime {
  return new CodemodeRuntime(options);
}
