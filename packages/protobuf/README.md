# @the-protobuf-project/runtime-ts-protobuf

Protobuf messages in TypeScript: the binary wire format, protojson readers and writers, the well-known types, enum and resource-name helpers, and the registry google.protobuf.Any uses. Generated messages are built on it.

```ts
import { TimestampCodec, fromBinary, toBinary } from "@the-protobuf-project/runtime-ts-protobuf";

const bytes = toBinary(TimestampCodec, "2026-11-22T10:00:00Z");
```

A module of [runtime-ts](https://github.com/the-protobuf-project/runtime-ts). Licensed under Apache 2.0.
