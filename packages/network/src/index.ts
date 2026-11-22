// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

// Calling and serving protobuf services over the network: google.api.http
// transcoding, the Connect protocol (JSON or binary) as client and server,
// and the Transport interface generated clients take.

export { type ConnectTransportOptions, connectError, connectTransport } from "./connect.ts";
export { connectHandler, type ServiceDescriptor, type ServiceImpl } from "./connect_handler.ts";
export { httpError, httpTransport } from "./http.ts";
export { expandPath, jsonPath, toQuery } from "./path_template.ts";
export {
  type CallOptions,
  callHeaders,
  callSignal,
  type Fetch,
  type FetchTransportOptions,
  type HttpRule,
  type MethodDescriptor,
  type Transport,
} from "./types.ts";
