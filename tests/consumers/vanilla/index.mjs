import assert from "node:assert/strict";
import { createCapture } from "@fonte-is/core";
import { collect } from "@fonte-is/core/server";

const capture = createCapture({ storage: "vanilla-consumer" });
assert.equal(typeof capture.page, "function");
assert.equal(collect.permitted(null), false);
assert.equal(
  await collect.parse(
    new Request("https://example.test", { method: "POST", body: "{}" }),
  ),
  null,
);

console.log(
  JSON.stringify({ ok: true, consumer: "vanilla", package: "@fonte-is/core" }),
);
