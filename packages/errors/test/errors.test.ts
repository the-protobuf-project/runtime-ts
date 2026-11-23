// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeFromConnect,
  codeFromHttpStatus,
  codeFromNumber,
  invalid,
  isCode,
  isStatusError,
  StatusError,
  toStatusError,
} from "../src/index.ts";

test("StatusError carries a code, reason and details, and serialises them", () => {
  const e = new StatusError("NOT_FOUND", "no shelf", { reason: "SHELF_MISSING", details: [{ a: 1 }] });
  assert.equal(e.name, "StatusError");
  assert.ok(e instanceof Error);
  assert.deepEqual(e.toJSON(), {
    code: "NOT_FOUND",
    message: "no shelf",
    reason: "SHELF_MISSING",
    details: [{ a: 1 }],
  });
});

test("codes map from numbers, Connect names and HTTP statuses", () => {
  assert.equal(codeFromNumber(5), "NOT_FOUND");
  assert.equal(codeFromNumber(99), "UNKNOWN");
  assert.equal(codeFromConnect("failed_precondition"), "FAILED_PRECONDITION");
  assert.equal(codeFromConnect("nonsense"), "UNKNOWN");
  assert.equal(codeFromHttpStatus(429), "RESOURCE_EXHAUSTED");
  assert.equal(codeFromHttpStatus(502), "INTERNAL");
  assert.equal(isCode("ABORTED"), true);
  assert.equal(isCode("aborted"), false);
});

test("toStatusError keeps StatusErrors and wraps anything else", () => {
  const original = new StatusError("ABORTED", "x");
  assert.equal(toStatusError(original), original);
  assert.equal(toStatusError(new TypeError("bad")).code, "UNKNOWN");
  assert.equal(toStatusError("plain").message, "plain");
});

test("invalid throws INVALID_ARGUMENT with the path", () => {
  assert.throws(() => invalid("book.title", "expected a string"), {
    code: "INVALID_ARGUMENT",
    message: "book.title: expected a string",
  });
});

test("a StatusError from another copy of the package is still recognised", () => {
  class Other extends Error {
    code = "NOT_FOUND";
    override name = "StatusError";
  }
  const foreign = new Other("gone");
  assert.equal(isStatusError(foreign), true);
  assert.equal(toStatusError(foreign).code, "NOT_FOUND");
  assert.equal(isStatusError(new Error("plain")), false);
});
