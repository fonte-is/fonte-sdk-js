import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  draftCreateArguments,
  productionJourneyArguments,
  productionTestSendArguments,
} from "./fixtures/cli-production-broadcast-arguments.mjs";
import {
  bearer,
  broadcastId,
  cancelledId,
  collectionId,
  draftEnvelope,
  draftId,
  hostedConfig,
  providerMessageId,
  progress,
  purposeId,
  testId,
  testReadback,
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
      "--expected-control-version",
      "9",
    ]).operator,
    {
      kind: "broadcast_control",
      workspace,
      broadcastId: cancelledId,
      operation: "cancel_remaining",
      expectedControlVersion: "9",
    },
  );

  const productionTest = parseArguments(productionTestSendArguments("--json"));
  assert.equal(productionTest.command, "operator");
  assert.equal(productionTest.json, true);
  assert.equal(productionTest.operator.textBody, "Hello synthetic subscribers");
  assert.equal(
    productionTest.operator.htmlBody,
    "<p>Hello synthetic subscribers</p>",
  );
  for (const field of ["--text-body", "--html-body"]) {
    assert.throws(() =>
      parseArguments(
        withoutOption(productionTestSendArguments("--json"), field),
      ),
    );
  }
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

test("versioned controls bind one exact observation and preserve settling states", async () => {
  for (const { command, operation, id, expected, status, controlState } of [
    {
      command: "pause",
      operation: "pause",
      id: broadcastId,
      expected: "7",
      status: "pausing",
      controlState: "paused",
    },
    {
      command: "resume",
      operation: "resume",
      id: broadcastId,
      expected: "8",
      status: "processing",
      controlState: "active",
    },
    {
      command: "cancel",
      operation: "cancel_remaining",
      id: cancelledId,
      expected: "9",
      status: "cancelling",
      controlState: "cancelled",
    },
  ]) {
    const requests = [];
    const result = await runProgram(
      controlArguments(command, id, expected),
      dependencies({
        configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
        fetch: async (input, init = {}) => {
          if (String(input).includes(".well-known/fonte-cli.json")) {
            return json(hostedConfig("http://127.0.0.1:43112"));
          }
          requests.push({ input: String(input), body: JSON.parse(init.body) });
          return json(
            controlReadback(
              id,
              status,
              controlState,
              String(Number(expected) + 1),
            ),
          );
        },
      }),
    );

    assert.equal(result.exitCode, 0, command);
    assert.equal(JSON.parse(result.stdout).result.status, status, command);
    assert.deepEqual(
      requests,
      [
        {
          input: `http://127.0.0.1:43112/v1/workspaces/${workspace}/marketing-broadcasts/${id}/control?environment=production`,
          body: { operation, expectedControlVersion: expected },
        },
      ],
      command,
    );
  }
});

test("stale and lost versioned controls are never retried or opposed", async () => {
  for (const [name, coreResponse, reason, effect] of [
    [
      "stale",
      () => json({ error: "broadcast_send_control_conflict" }, 409),
      "broadcast_send_control_conflict",
      "none",
    ],
    [
      "lost",
      () => {
        throw new Error("accepted response lost");
      },
      "core_api_unavailable",
      "unknown",
    ],
  ]) {
    let controlCalls = 0;
    const result = await runProgram(
      controlArguments("pause", broadcastId, "7"),
      dependencies({
        configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
        fetch: async (input, init = {}) => {
          if (String(input).includes(".well-known/fonte-cli.json")) {
            return json(hostedConfig("http://127.0.0.1:43112"));
          }
          controlCalls += 1;
          assert.deepEqual(JSON.parse(init.body), {
            operation: "pause",
            expectedControlVersion: "7",
          });
          return coreResponse();
        },
      }),
    );
    const receipt = JSON.parse(result.stdout);

    assert.equal(result.exitCode, 3, name);
    assert.equal(receipt.reason, reason, name);
    assert.equal(receipt.core_effect, effect, name);
    assert.equal(controlCalls, 1, name);
  }
});

test("one isolated fake-Core journey exercises every production operator route without a send", async (context) => {
  const fake = await openFakeCore(context);
  const receipts = await runJourney(fake.configUrl);
  assert.equal(receipts[1].result.draft_id, draftId);
  assert.equal(receipts[3].result.counts.final_eligible, 2);
  assert.equal(receipts[5].result.status, "terminal");
  assert.equal(receipts[5].result.provider_message_id, providerMessageId);
  assert.equal(receipts[5].result.accepted_email_usage_quantity, 1);
  assert.equal(receipts[5].result.accepted_email_usage_record_count, 1);
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
  for (const forbidden of [bearer, "verified@example.test"]) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.equal(output.includes(providerMessageId), true);
  assert.equal(
    fake.state.requests.some(({ path }) => path.includes("email-sandbox")),
    false,
  );
});

test("a refused terminal production test is blocked with a stable exit reason", async () => {
  const refused = {
    ...testReadback("terminal"),
    acceptedCount: 0,
    refusedCount: 1,
    unknownCount: 0,
    billing: { acceptedUsageQuantity: 0, usageRecordCount: 0 },
    outbox: { providerMessageId: null },
  };
  const result = await runProgram(
    [
      "broadcast",
      "test",
      "status",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--draft-id",
      draftId,
      "--test-id",
      testId,
      "--json",
    ],
    dependencies({
      configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
      fetch: async (input) =>
        String(input).includes(".well-known/fonte-cli.json")
          ? json(hostedConfig("http://127.0.0.1:43112"))
          : json(refused),
    }),
  );

  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "");
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "production_test_terminal_refused");
  assert.equal(receipt.result.accepted_count, 0);
  assert.equal(receipt.result.refused_count, 1);
  assert.equal(receipt.result.unknown_count, 0);
  assert.equal(receipt.result.provider_message_id, null);
});

test("a lost test-send response recovers only through draft and terminal GET readback", async () => {
  let latestTestId = null;
  let testSendCalls = 0;
  const fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes(".well-known/fonte-cli.json")) {
      return json(hostedConfig("http://127.0.0.1:43112"));
    }
    if (
      url.includes(`/broadcast-drafts/${draftId}/test-deliveries/${testId}`)
    ) {
      return json(testReadback("terminal"));
    }
    if (url.includes(`/broadcast-drafts/${draftId}`)) {
      return json(draftEnvelope(null, latestTestId));
    }
    if (url.includes(`/marketing-broadcasts/${draftId}/send-approvals`)) {
      testSendCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.textBody, "Hello synthetic subscribers");
      assert.equal(body.htmlBody, "<p>Hello synthetic subscribers</p>");
      latestTestId = testId;
      throw new Error("response lost after durable authorization");
    }
    throw new Error(`unexpected synthetic request: ${url}`);
  };
  const configured = {
    configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
    fetch,
  };

  const baseline = await runProgram(
    draftReadArguments(),
    dependencies(configured),
  );
  assert.equal(JSON.parse(baseline.stdout).result.latest_test_id, null);

  const lost = await runProgram(
    productionTestSendArguments("--json"),
    dependencies(configured),
  );
  assert.equal(lost.exitCode, 3);
  assert.equal(JSON.parse(lost.stdout).core_effect, "unknown");
  assert.equal(testSendCalls, 1);

  const recoveredDraft = await runProgram(
    draftReadArguments(),
    dependencies(configured),
  );
  assert.equal(JSON.parse(recoveredDraft.stdout).result.latest_test_id, testId);
  assert.equal(testSendCalls, 1);

  const terminal = await runProgram(
    testStatusArguments(),
    dependencies(configured),
  );
  const receipt = JSON.parse(terminal.stdout);
  assert.equal(terminal.exitCode, 0);
  assert.equal(receipt.result.provider_message_id, providerMessageId);
  assert.equal(receipt.result.accepted_email_usage_quantity, 1);
  assert.equal(receipt.result.accepted_email_usage_record_count, 1);
  assert.equal(testSendCalls, 1);
});

test("production test readback rejects MessageId and usage mismatches", async () => {
  const acceptedWithoutMessage = testReadback("terminal");
  acceptedWithoutMessage.outbox.providerMessageId = null;
  const unknownWithMessage = testReadback("processing");
  unknownWithMessage.status = "unknown";
  unknownWithMessage.outbox.providerMessageId = providerMessageId;

  for (const malformed of [acceptedWithoutMessage, unknownWithMessage]) {
    const result = await runProgram(
      testStatusArguments(),
      dependencies({
        configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
        fetch: async (input) =>
          String(input).includes(".well-known/fonte-cli.json")
            ? json(hostedConfig("http://127.0.0.1:43112"))
            : json(malformed),
      }),
    );
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 3);
    assert.equal(receipt.reason, "core_operator_receipt_invalid");
    assert.equal(receipt.core_effect, "none");
    assert.equal(receipt.result, null);
  }
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

function draftReadArguments() {
  return [
    "broadcast",
    "draft",
    "read",
    "--workspace",
    workspace,
    "--environment",
    "production",
    "--draft-id",
    draftId,
    "--json",
  ];
}

function testStatusArguments() {
  return [
    "broadcast",
    "test",
    "status",
    "--workspace",
    workspace,
    "--environment",
    "production",
    "--draft-id",
    draftId,
    "--test-id",
    testId,
    "--json",
  ];
}

function withoutOption(argv, name) {
  const index = argv.indexOf(name);
  return [...argv.slice(0, index), ...argv.slice(index + 2)];
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function controlArguments(command, id, expectedControlVersion) {
  return [
    "broadcast",
    command,
    "--workspace",
    workspace,
    "--environment",
    "production",
    "--broadcast-id",
    id,
    "--expected-control-version",
    expectedControlVersion,
    "--json",
  ];
}

function controlReadback(id, status, controlState, version) {
  const settling = status === "pausing" || status === "cancelling";
  return {
    ...progress("processing", id),
    status,
    controlState,
    controlVersion: version,
    progressVersion: version,
    pendingRecipientCount: settling ? 0 : 1,
    claimedRecipientCount: settling ? 1 : 0,
    currentRatePerSecond: controlState === "active" ? 1 : null,
  };
}
