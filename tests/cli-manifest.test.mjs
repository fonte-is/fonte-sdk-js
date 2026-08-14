import assert from "node:assert/strict";
import test from "node:test";

import { parseManifest } from "../packages/cli/dist/manifest.js";

const valid = {
  schema_version: "fonte.local_installation.v1",
  installation_id: "10000000-0000-4000-8000-000000000001",
  cli_version: "0.1.0",
  adapter_id: "next_app_router",
  adapter_version: "v1",
  sdk_package: "@fonte-is/nextjs",
  sdk_version: "0.1.0",
  plan_sha256: "a".repeat(64),
  managed_operations: [
    {
      id: "installation_module",
      kind: "created_file",
      path: "fonte/installation.ts",
      sha256: "b".repeat(64),
    },
  ],
};

test("local manifest accepts only exact nonsecret schema", () => {
  assert.deepEqual(parseManifest(valid), valid);
  assert.equal(parseManifest({ ...valid, secret: "forbidden" }), null);
  assert.equal(
    parseManifest({ ...valid, installation_id: "not-a-uuid" }),
    null,
  );
  assert.equal(
    parseManifest({
      ...valid,
      managed_operations: [
        ...valid.managed_operations,
        valid.managed_operations[0],
      ],
    }),
    null,
  );
});
