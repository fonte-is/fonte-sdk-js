import assert from "node:assert/strict";
import test from "node:test";
import { createCoreOperatorClient } from "../packages/cli/dist/operator-client.js";
import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const batch = "10000000-0000-4000-8000-000000000501";
const input = {
  workspace: "northstar",
  environment: "sandbox",
  contactImportBatchId: batch,
};
const completed = {
  tenantId: "10000000-0000-4000-8000-000000000502",
  environment: "sandbox",
  status: "completed",
  contactImportBatchId: batch,
  identitySetSha256: "a".repeat(64),
};

function harness(reply = completed) {
  const calls = [];
  const client = createCoreOperatorClient({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(reply);
    },
  });
  return { client, calls };
}

test("completed import read keeps the existing batch route and exact canonical identity", async () => {
  const h = harness();
  assert.deepEqual(await h.client.readContactImportStatus(input), {
    kind: "contact_import_status",
    environment: "sandbox",
    status: "completed",
    contact_import_batch_id: batch,
    identity_set_sha256: "a".repeat(64),
  });
  assert.equal(h.calls.length, 1);
  assert.equal(
    h.calls[0].url,
    "https://api.example.test/v1/broadcast-email/contact-imports",
  );
  assert.equal(h.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(h.calls[0].init.body), {
    workspaceSlug: "northstar",
    environment: "sandbox",
    contactImportBatchId: batch,
  });
});

test("batch reads preserve a canonical workspace code exactly", async () => {
  const h = harness();
  await h.client.readContactImportStatus({ ...input, workspace: "A3" });
  assert.equal(JSON.parse(h.calls[0].init.body).workspaceSlug, "A3");
  const historicalBatch = "ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF";
  const upper = harness({
    ...completed,
    contactImportBatchId: historicalBatch.toLowerCase(),
  });
  assert.equal(
    (
      await upper.client.readContactImportStatus({
        ...input,
        contactImportBatchId: historicalBatch,
      })
    ).contact_import_batch_id,
    historicalBatch.toLowerCase(),
  );
  assert.equal(
    JSON.parse(upper.calls[0].init.body).contactImportBatchId,
    historicalBatch,
  );
  assert.throws(() =>
    parseArguments([
      "bridge",
      "import",
      "status",
      "--workspace",
      "A--3",
      "--environment",
      "sandbox",
      "--contact-import-batch-id",
      batch,
    ]),
  );
});

test("incomplete, malformed and mismatched batch reads cannot provide an audience identity", async () => {
  for (const reply of [
    { ...completed, status: "pending" },
    { ...completed, identitySetSha256: null },
    { ...completed, environment: "production" },
    {
      ...completed,
      contactImportBatchId: "10000000-0000-4000-8000-000000000503",
    },
  ]) {
    await assert.rejects(harness(reply).client.readContactImportStatus(input), {
      reason: "core_operator_receipt_invalid",
      coreEffect: "none",
    });
  }
  const h = harness();
  for (const invalid of [
    { ...input, extra: "value" },
    { ...input, environment: "other" },
    { ...input, contactImportBatchId: "guessed-name" },
  ]) {
    await assert.rejects(h.client.readContactImportStatus(invalid), {
      reason: "contact_import_request_invalid",
      coreEffect: "none",
    });
  }
  assert.equal(h.calls.length, 0);
});

test("batch status remains available through the CLI without importing or sending", async () => {
  const args = [
    "bridge",
    "import",
    "status",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--contact-import-batch-id",
    batch,
    "--json",
  ];
  assert.deepEqual(parseArguments(args).operator, {
    kind: "bridge_contact_import_status",
    ...input,
  });
  const apiCalls = [];
  const result = await runProgram(args, {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000504",
    runner: {
      run: async () => {
        throw Error("unexpected process");
      },
    },
    operator: {
      authorize: async () => "synthetic-bearer",
      sleep: async () => {},
      fetch: async (url, init) => {
        if (String(url).endsWith("fonte-cli.json"))
          return Response.json({
            schema: "fonte.cli.hosted_config.v1",
            authorizationServer: "https://accounts.example.test",
            clientId: "synthetic-client",
            coreApiBaseUrl: "https://api.example.test",
            redirectUri: "http://127.0.0.1:49671/callback",
            scopes: ["email"],
          });
        apiCalls.push({ url: String(url), init });
        return Response.json(completed);
      },
    },
  });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.receipt.core_effect, "none");
  assert.equal(
    result.receipt.result.identity_set_sha256,
    completed.identitySetSha256,
  );
  assert.equal(apiCalls.length, 1);
});
