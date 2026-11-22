# @the-protobuf-project/codemode

Code Mode: runs model-written code against generated connectors in a sandbox, with approval pauses, replay, rollback, snippets and search. See the [runtime docs](https://github.com/the-protobuf-project/codemode/blob/main/docs/runtime.md).

```ts
import { createCodemode } from "@the-protobuf-project/codemode";
import { QuickJSExecutor } from "@the-protobuf-project/codemode/quickjs";

const runtime = createCodemode({ catalog, connectors, executor: new QuickJSExecutor() });
```

Part of [runtime-ts](https://github.com/the-protobuf-project/runtime-ts). Licensed under Apache 2.0.
