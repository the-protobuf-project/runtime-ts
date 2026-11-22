// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// The slice of the Workers runtime module this package uses, so it type-checks
// without @cloudflare/workers-types' global DOM replacements.
declare module "cloudflare:workers" {
  export class RpcTarget {}
}
