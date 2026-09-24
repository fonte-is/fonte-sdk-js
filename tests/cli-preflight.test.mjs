import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const draftId = "10000000-0000-4000-8000-000000000401";
const collectionId = "10000000-0000-4000-8000-000000000402";
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const coreUrl = "http://127.0.0.1:43112";
const postalAddress = "1 Synthetic Way";
const bearer = "header.payload.signature";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreUrl,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("preflight grammar requires the exact persisted-draft inputs", () => {
  assert.deepEqual(parseArguments(preflightArguments("--json")), {
    command: "operator",
    apply: false,
    json: true,
    operator: {
      kind: "broadcast_preflight",
      workspace: "northstar",
      environment: "production",
      draftId,
      expectedVersion: 3,
      postalAddress,
      audienceReuseOverride: null,
    },
  });
  for (const invalid of [
    preflightArguments().filter(
      (value) => value !== "--postal-address" && value !== postalAddress,
    ),
    [...preflightArguments(), "--subject", "Unconfirmed subject"],
    preflightArguments().map((value) => (value === "3" ? "0" : value)),
    preflightArguments().map((value) =>
      value === postalAddress ? " ".repeat(2_001) : value,
    ),
  ]) {
    assert.throws(() => parseArguments(invalid));
  }
});

test("preflight sends only the exact Core observation command", async () => {
  const requests = [];
  const result = await runProgram(
    preflightArguments("--json"),
    dependencies(async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input) === configUrl) return json(config);
      return json(
        readyReceipt({
          subject: "must-not-escape",
          body: "must-not-escape",
          recipients: ["hidden@example.test"],
          providerPayload: { secret: "must-not-escape" },
        }),
      );
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  const request = requests[1];
  assert.equal(
    request.url,
    `${coreUrl}/v1/workspaces/northstar/marketing-broadcasts/${draftId}/preflight?environment=production`,
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.authorization, `Bearer ${bearer}`);
  assert.equal("idempotency-key" in request.init.headers, false);
  assert.deepEqual(JSON.parse(request.init.body), {
    expectedVersion: 3,
    postalAddress,
  });

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.reason, "broadcast_preflight_ready");
  assert.equal(receipt.core_effect, "none");
  assert.equal(
    receipt.authority.contract_id,
    "fonte.core.broadcast_preflight.v1",
  );
  assert.equal(receipt.result.schema_version, "broadcast_preflight.v1");
  assert.equal(receipt.result.ready, true);
  assert.equal(
    receipt.result.checks.audience.evidence.counts.final_eligible,
    6,
  );
  assert.equal(
    receipt.result.checks.provider_capacity.evidence.daily_remaining,
    700,
  );
  assertSanitized(result.stdout);
});

test("human output lists every current and future typed blocker", async () => {
  const response = blockedReceipt();
  const result = await runProgram(
    preflightArguments(),
    dependencies(async (input) =>
      String(input) === configUrl ? json(config) : json(response),
    ),
  );

  assert.equal(result.exitCode, 3);
  assert.equal(result.receipt.reason, "broadcast_preflight_blocked");
  assert.equal(result.receipt.result.ready, false);
  assert.equal(result.receipt.result.checks.billing.evidence, null);
  assert.equal(result.receipt.result.checks.provider_capacity.evidence, null);
  for (const { authority, code } of response.blockers) {
    assert.match(result.stdout, new RegExp(`- ${authority}: ${code}`));
  }
  assert.equal(result.stdout.includes("ready."), false);
  assertSanitized(result.stdout);
});

test("preflight preserves Core's protected transactional reserve", async () => {
  const response = readyReceipt();
  Object.assign(response.checks.providerCapacity.evidence, {
    protectedTransactionalReserve: 50,
    dailyRemaining: 650,
  });
  const result = await runProgram(
    preflightArguments("--json"),
    dependencies(async (input) =>
      String(input) === configUrl ? json(config) : json(response),
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.reason, "broadcast_preflight_ready");
  const capacity = result.receipt.result.checks.provider_capacity.evidence;
  assert.equal(capacity.protected_transactional_reserve, 50);
  assert.equal(capacity.daily_remaining, 650);
  assert.equal(result.receipt.core_effect, "none");
  assertSanitized(result.stdout);
});

test("preflight rejects missing, malformed, or unaccounted transactional reserve", async () => {
  for (const patch of [
    { protectedTransactionalReserve: undefined },
    { protectedTransactionalReserve: null },
    { protectedTransactionalReserve: -1 },
    { protectedTransactionalReserve: 1.5 },
    { protectedTransactionalReserve: 1_001 },
    { protectedTransactionalReserve: 50, dailyRemaining: 700 },
  ]) {
    const response = readyReceipt();
    Object.assign(response.checks.providerCapacity.evidence, patch);
    const result = await runProgram(
      preflightArguments("--json"),
      dependencies(async (input) =>
        String(input) === configUrl ? json(config) : json(response),
      ),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.reason, "core_operator_receipt_invalid");
    assert.equal(result.receipt.result, null);
    assert.equal(result.receipt.core_effect, "none");
  }
});

test("unexposed production authority declarations remain unsupported", async () => {
  for (const operation of [
    "prepare",
    "send",
    "reconcile",
    "watch",
    "duplicate",
  ]) {
    let calls = 0;
    const result = await runProgram(
      ["broadcast", operation, "--workspace", "northstar", "--json"],
      dependencies(
        async () => {
          calls += 1;
          throw new Error("must not request");
        },
        async () => {
          calls += 1;
          throw new Error("must not authorize");
        },
      ),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.outcome, "unsupported_authority");
    assert.equal(result.receipt.core_effect, "none");
    assert.equal(calls, 0);
  }
});

test("a lost preflight response leaves readiness unknown with no Core effect", async () => {
  const result = await runProgram(
    preflightArguments(),
    dependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      throw new Error("response lost");
    }),
  );

  assert.equal(result.exitCode, 3);
  assert.equal(result.receipt.reason, "core_api_unavailable");
  assert.equal(result.receipt.core_effect, "none");
  assert.equal(result.receipt.result, null);
  assert.match(result.stdout, /Readiness: unknown/);
  assert.equal(result.stdout.includes("ready"), false);
});

function preflightArguments(extra) {
  return [
    "broadcast",
    "preflight",
    "--workspace",
    "northstar",
    "--environment",
    "production",
    "--draft-id",
    draftId,
    "--expected-version",
    "3",
    "--postal-address",
    postalAddress,
    ...(extra ? [extra] : []),
  ];
}

function readyReceipt(extra = {}) {
  const ready = (evidence) => ({ status: "ready", reasonCode: null, evidence });
  return {
    schemaVersion: "broadcast_preflight.v1",
    workspaceId: "workspace_synthetic_preflight",
    workspaceSlug: "northstar",
    environment: "production",
    broadcastDraftId: draftId,
    requestedDraftVersion: 3,
    confirmedDraftVersion: 3,
    observedAt: "2026-08-20T13:00:00.000Z",
    ready: true,
    blockers: [],
    checks: {
      draft: ready({ version: 3, updatedAt: "2026-08-20T12:30:00.000Z" }),
      rendering: ready(null),
      authorization: ready({
        renderContentDigest: "sha256:synthetic-preflight-render",
        senderId: "sender_synthetic_preflight",
      }),
      sender: ready({ senderId: "sender_synthetic_preflight" }),
      audience: ready(audienceEvidence()),
      audienceReuse: ready({
        identity: {
          version: "audience_reuse_identity.v1",
          digest: `sha256:${"a".repeat(64)}`,
        },
        priorAuthorizationCount: 0,
        latestAuthorizedAt: null,
        overrideRequired: false,
        overrideAccepted: false,
      }),
      billing: ready({
        billingRequired: false,
        eligibleRecipientCount: 6,
        reasonCode: null,
      }),
      safetyFeedback: ready({ observedAt: "2026-08-20T12:59:59.000Z" }),
      providerCapacity: ready({
        region: "us-east-1",
        observedAt: "2026-08-20T12:59:59.000Z",
        max24HourSend: 1_000,
        effectiveSentLast24Hours: 300,
        protectedTransactionalReserve: 0,
        dailyRemaining: 700,
        maxSendRate: 20,
        operatingSendsPerSecond: 10,
        providerHealth: "healthy",
      }),
    },
    ...extra,
  };
}

function blockedReceipt() {
  const result = readyReceipt();
  return {
    ...result,
    ready: false,
    blockers: [
      { authority: "rendering", code: "rendering_not_ready" },
      {
        authority: "authorization",
        code: "authorization_reuse_evidence_unavailable",
      },
      { authority: "billing", code: "billing_authority_unavailable" },
      { authority: "provider_capacity", code: "provider_capacity_unavailable" },
    ],
    checks: {
      ...result.checks,
      rendering: {
        status: "blocked",
        reasonCode: "rendering_not_ready",
        evidence: null,
      },
      authorization: {
        status: "unavailable",
        reasonCode: "authorization_reuse_evidence_unavailable",
        evidence: null,
      },
      billing: {
        status: "unavailable",
        reasonCode: "billing_authority_unavailable",
        evidence: null,
      },
      providerCapacity: {
        status: "unavailable",
        reasonCode: "provider_capacity_unavailable",
        evidence: null,
      },
    },
  };
}

function audienceEvidence() {
  return {
    communicationPurposeId: "Product updates",
    audienceKind: "recipient_expression",
    recipientExpression: {
      include: [{ kind: "collection", collectionId }],
      exclude: [],
    },
    sourceProvenance: [
      {
        kind: "collection",
        collectionId,
        collectionKind: "segment",
        label: "Synthetic subscribers",
        sourceConnectionId: null,
        externalCollectionId: null,
        createdAt: "2026-08-20T12:00:00.000Z",
      },
    ],
    counts: {
      matched: 10,
      excluded: 1,
      ineligibleProtected: 2,
      unknown: 1,
      finalEligible: 6,
    },
  };
}

function assertSanitized(output) {
  for (const forbidden of [
    bearer,
    postalAddress,
    "hidden@example.test",
    "must-not-escape",
    '"subject"',
    '"body"',
    '"recipients"',
    '"providerPayload"',
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
}

function dependencies(fetcher, authorize = async () => bearer) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000499",
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch: fetcher,
      authorize,
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
