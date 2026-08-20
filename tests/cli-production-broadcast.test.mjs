import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  draftCreateArguments,
  productionJourneyArguments,
} from "./fixtures/cli-production-broadcast-arguments.mjs";
import {
  bearer,
  broadcastId,
  cancelledId,
  collectionId,
  draftId,
  hostedConfig,
  purposeId,
  workspace,
} from "./fixtures/cli-production-broadcast-responses.mjs";
import { openFakeCore } from "./fixtures/cli-production-broadcast-server.mjs";

test("production grammar binds factual audience IDs and rejects filename or sandbox targeting", () => {
  const parsed = parseArguments(draftCreateArguments("--json"));
  assert.equal(parsed.command, "operator");
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.operator.audience, {
    kind: "recipient_expression",
    expression: {
      include: [{ kind: "collection", collectionId }],
      exclude: [],
    },
  });
  for (const invalid of [
    [...draftCreateArguments(), "--import-filename", "contacts.csv"],
    draftCreateArguments().map((value) =>
      value === "production" ? "sandbox" : value,
    ),
    [...draftCreateArguments(), "--exclude-collection", collectionId],
  ])
    assert.throws(() => parseArguments(invalid));

  assert.deepEqual(
    parseArguments([
      "broadcast",
      "cancel",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--broadcast-id",
      cancelledId,
    ]).operator,
    {
      kind: "broadcast_control",
      workspace,
      broadcastId: cancelledId,
      operation: "cancel_remaining",
    },
  );
});

test("lost production mutations remain unknown until explicit Core readback", async () => {
  let calls = 0;
  const result = await runProgram(
    draftCreateArguments("--json"),
    dependencies({
      configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
      fetch: async () => {
        calls += 1;
        if (calls === 1) return json(hostedConfig("http://127.0.0.1:43112"));
        throw new Error("response lost");
      },
    }),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(receipt.result, null);
  assert.equal(result.stdout.includes("created"), false);
});

test("one isolated fake-Core journey exercises every production operator route without a send", async (context) => {
  const fake = await openFakeCore(context);
  const receipts = await runJourney(fake.configUrl);
  assert.equal(receipts[1].result.draft_id, draftId);
  assert.equal(receipts[3].result.counts.final_eligible, 2);
  assert.equal(receipts[5].result.status, "terminal");
  assert.equal(receipts[6].result.ready, true);
  assert.equal(receipts[7].result.broadcast_id, broadcastId);
  assert.equal(receipts[10].result.status, "terminal");
  assert.equal(receipts[11].result.status, "cancelled");
  assert.equal(
    receipts[12].result.audience_targeting.communication_purpose_id,
    purposeId,
  );
  assert.equal(fake.state.testReads, 2);
  assert.equal(fake.state.progressReads, 2);
  const output = JSON.stringify(receipts);
  for (const forbidden of [
    bearer,
    "verified@example.test",
    "provider-secret",
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.equal(
    fake.state.requests.some(({ path }) => path.includes("email-sandbox")),
    false,
  );
});

async function runJourney(configUrl) {
  const receipts = [];
  for (const command of productionJourneyArguments()) {
    const result = await runProgram(command, dependencies({ configUrl }));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    receipts.push(JSON.parse(result.stdout));
  }
  return receipts;
}

function dependencies(options) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000599",
    runner: { run: async () => 1 },
    operator: {
      configUrl: options.configUrl,
      fetch: options.fetch ?? globalThis.fetch,
      authorize: async () => bearer,
      sleep: async () => undefined,
    },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
