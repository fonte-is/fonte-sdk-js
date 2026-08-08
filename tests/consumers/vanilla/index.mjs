import assert from "node:assert/strict";
import { createCapture } from "@fonte-is/core";
import { createClient } from "@fonte-is/core/server";

const capture = createCapture({ storage: "vanilla-consumer" });
assert.equal(typeof capture.page, "function");
assert.throws(
  () => createClient({ tenantApiKey: "short" }),
  /at least 24 characters/,
);

console.log(
  JSON.stringify({
    ok: true,
    consumer: "vanilla",
    package: "@fonte-is/core@0.1.0",
  }),
);
