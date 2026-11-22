# @the-protobuf-project/runtime-ts-errors

StatusError: an error with a gRPC status code, reason and details, and mapping from HTTP statuses and Connect codes.

```ts
import { StatusError } from "@the-protobuf-project/runtime-ts-errors";

throw new StatusError("NOT_FOUND", "shelves/poetry does not exist");
```

A module of [runtime-ts](https://github.com/the-protobuf-project/runtime-ts). Licensed under Apache 2.0.
