import assert from "node:assert/strict";
import test from "node:test";

import {
  HOSTED_CONFIG_URL,
  loadHostedConfig,
  parseHostedConfig,
} from "../packages/cli/dist/hosted-config.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import {
  runHostedTest,
  testBlockedReceipt,
} from "../packages/cli/dist/hosted-test.js";
import { parseOAuthCallback } from "../packages/cli/dist/oauth-callback.js";
import { renderHuman } from "../packages/cli/dist/render.js";

const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://project.supabase.co/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.fonte.is",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const draftId = "10000000-0000-4000-8000-000000000010";
const canaryId = "10000000-0000-4000-8000-000000000011";

test("hosted configuration is exact and HTTPS-bound", () => {
  assert.equal(
    HOSTED_CONFIG_URL,
    "https://fonte.is/.well-known/fonte-cli.json",
  );
  assert.deepEqual(parseHostedConfig(config), config);
  assert.throws(
    () =>
      parseHostedConfig({ ...config, coreApiBaseUrl: "http://api.fonte.is" }),
    HostedTestBlockedError,
  );
  assert.throws(
    () => parseHostedConfig({ ...config, extra: true }),
    HostedTestBlockedError,
  );
});

test("local exec discovery is loopback-only and may target loopback Core", async () => {
  const local = { ...config, coreApiBaseUrl: "http://127.0.0.1:3010" };
  assert.deepEqual(
    await loadHostedConfig(
      async () => json(local),
      "http://127.0.0.1:3000/.well-known/fonte-cli.json",
    ),
    local,
  );
  await assert.rejects(
    loadHostedConfig(
      async () => json(local),
      "http://localhost:3000/.well-known/fonte-cli.json",
    ),
    HostedTestBlockedError,
  );
  await assert.rejects(
    loadHostedConfig(
      async () => json(local),
      "https://example.test/.well-known/fonte-cli.json",
    ),
    HostedTestBlockedError,
  );
});

test("OAuth callback requires the fixed host, exact state, and one result", () => {
  const callback = parseOAuthCallback(
    "/callback?code=one&state=expected",
    "127.0.0.1:49671",
    "expected",
  );
  assert.equal(callback.searchParams.get("code"), "one");
  assert.throws(
    () =>
      parseOAuthCallback(
        "/callback?code=one&state=wrong",
        "127.0.0.1:49671",
        "expected",
      ),
    /authorization_state_invalid/,
  );
  assert.throws(() =>
    parseOAuthCallback(
      "/callback?code=one&state=expected",
      "localhost:49671",
      "expected",
    ),
  );
  assert.throws(
    () =>
      parseOAuthCallback(
        "/callback?error=access_denied&state=expected",
        "127.0.0.1:49671",
        "expected",
      ),
    /authorization_denied/,
  );
});

test("hosted blockers explain the problem and next action to a human", () => {
  const output = renderHuman(
    testBlockedReceipt("fonte", "verified_account_email_required"),
  );
  assert.match(output, /no stable verified email recipient/i);
  assert.match(output, /Reason: verified_account_email_required/);
  assert.match(output, /Next: Verify the account email/);
  assert.match(output, /Sandbox draft retained: no/);
});

test("draft retention is unknown when the create response is lost", async () => {
  let request = 0;
  const receipt = await runHostedTest(
    "fonte",
    "10000000-0000-4000-8000-000000000014",
    {
      fetch: async () => {
        request += 1;
        if (request === 1) return json(config);
        throw new Error("connection lost after draft commit");
      },
      authorize: async () => "header.payload.signature",
      sleep: async () => assert.fail("a lost create response must not poll"),
    },
  );

  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.sandbox_draft_id, null);
  assert.equal(receipt.sandbox_draft_retained, null);
  assert.match(renderHuman(receipt), /Sandbox draft retained: unknown/);
});

test("test returns a truthful accepted-only terminal receipt", async () => {
  const requests = [];
  const receipt = await runHostedTest(
    "fonte",
    "10000000-0000-4000-8000-000000000012",
    {
      fetch: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        if (String(input).endsWith("/.well-known/fonte-cli.json"))
          return json(config);
        if (String(input).includes("/broadcast-drafts")) {
          return json(
            { draft: { broadcastDraftId: draftId, version: 1 } },
            201,
          );
        }
        if (init.method === "POST")
          return json({ sandboxEmailId: canaryId }, 201);
        return json({
          status: "terminal",
          provider: {
            acceptedCount: 1,
            refusedCount: 0,
            unknownCount: 0,
            messageId: "provider-1",
            errorCode: null,
          },
          billing: { quantity: 1 },
        });
      },
      authorize: async (received) => {
        assert.deepEqual(received, config);
        return "header.payload.signature";
      },
      sleep: async () => assert.fail("terminal result must not sleep"),
    },
  );

  assert.equal(receipt.outcome, "terminal");
  assert.equal(receipt.provider_submission, "accepted");
  assert.equal(receipt.sandbox_draft_id, draftId);
  assert.equal(receipt.sandbox_draft_retained, true);
  assert.equal(receipt.accepted_email_usage_quantity, 1);
  assert.equal(receipt.inbox_delivery_confirmed, false);
  assert.equal(receipt.token_persisted, false);
  assert.match(requests[1].init.headers.authorization, /^Bearer /);
  assert.equal(
    JSON.stringify(receipt).includes("header.payload.signature"),
    false,
  );
});

test("test refuses a non-accepted usage charge", async () => {
  const receipt = await runHostedTest(
    "fonte",
    "10000000-0000-4000-8000-000000000013",
    {
      fetch: sequenceFetcher({
        status: "terminal",
        provider: {
          acceptedCount: 0,
          refusedCount: 1,
          unknownCount: 0,
          messageId: null,
          errorCode: "provider_refused",
        },
        billing: { quantity: 1 },
      }),
      authorize: async () => "header.payload.signature",
      sleep: async () => undefined,
    },
  );
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "core_receipt_invalid");
  assert.equal(receipt.provider_submission, "processing");
  assert.equal(receipt.sandbox_draft_id, draftId);
  assert.equal(receipt.sandbox_draft_retained, true);
  assert.equal(receipt.accepted_email_usage_quantity, null);
});

function sequenceFetcher(terminal) {
  let index = 0;
  return async () => {
    index += 1;
    if (index === 1) return json(config);
    if (index === 2)
      return json({ draft: { broadcastDraftId: draftId, version: 1 } }, 201);
    if (index === 3) return json({ sandboxEmailId: canaryId }, 201);
    return json(terminal);
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
