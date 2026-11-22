# @the-protobuf-project/runtime-ts/network

Calls and serves protobuf services: google.api.http transcoding and the Connect protocol, JSON or binary, as clients, and a Connect fetch handler as a server. Generated clients take its Transport.

```ts
import { connectTransport } from "@the-protobuf-project/runtime-ts/network";

const client = new LibraryServiceClient(connectTransport({ baseUrl: "https://library.example.com" }));
```

A module of [runtime-ts](https://github.com/the-protobuf-project/runtime-ts). Licensed under Apache 2.0.
