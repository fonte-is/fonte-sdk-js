import assert from "node:assert/strict";
import test from "node:test";
import { collect as coreCollect } from "@fonte-is/core/server";

import {
  INSTALLATION_VERIFICATION_ADAPTER_ID,
  normalizeInstallationVerificationConfig,
} from "@fonte-is/nextjs/installation-verification";
import { collect } from "@fonte-is/nextjs/server";

test("Next server is the exact Core collection primitive", () => {
  assert.equal(collect, coreCollect);
});

const validBody = {
  schemaVersion: "fonte.acquisition.v2",
  sourceEvidence: { query: [], cookies: [] },
  collectionVersion: "test-v1",
  occurrenceId: "10000000-0000-4000-8000-000000000003",
  occurredAt: "2026-09-17T12:00:00.000Z",
  eventId: "10000000-0000-4000-8000-000000000001",
  eventType: "source_touch",
  journeyId: "10000000-0000-4000-8000-000000000002",
  scope: {
    fonte_journey_id: "10000000-0000-4000-8000-000000000002",
    current_url:
      "https://example.test/launch?utm_source=demo&utm_medium=paid_social&secret=drop",
    utm_source: "demo",
    utm_medium: "paid_social",
  },
};

test("Next parser validates and canonicalizes browser touch bodies", async () => {
  const body = await collect.parse(
    new Request("https://example.test/api/fonte/collect", {
      method: "POST",
      body: JSON.stringify(validBody),
    }),
  );
  assert.equal(body?.eventType, "source_touch");
  assert.equal(body?.scope.current_url.includes("secret="), false);
  assert.equal(
    await collect.parse(
      new Request("https://example.test", { method: "POST", body: "{" }),
    ),
    null,
  );
});

test("Next accepts only matching browser and route origins", async () => {
  const body = await collect.parse(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(validBody),
    }),
  );
  assert.ok(body);
  const accepted = collect.acceptScope(body.scope, {
    siteUrl: "https://example.test",
    requestOrigin: "https://example.test",
    userAgent: "Synthetic Browser",
  });
  assert.equal(accepted?.client_user_agent, "Synthetic Browser");
  assert.equal(
    collect.acceptScope(body.scope, {
      siteUrl: "https://example.test",
      requestOrigin: "https://other.example",
    }),
    null,
  );
  assert.equal(
    collect.acceptScope(body.scope, {
      siteUrl: "https://example.test",
      requestOrigin: null,
    }),
    null,
  );
  assert.equal(
    collect.acceptScope(body.scope, {
      siteUrl: "https://example.test/path",
      requestOrigin: "https://example.test",
    }),
    null,
  );
});

test("Next admits bounded source evidence using explicit selected fields", async () => {
  const input = {
    ...validBody,
    sourceEvidence: {
      query: [
        { name: "campaign_click", value: "click-1" },
        { name: "other_click", value: "click-2" },
      ],
      cookies: [{ name: "visit_cookie", value: "visit-1" }],
    },
  };
  const body = await collect.parse(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  assert.ok(body);
  const policy = {
    status: "granted",
    version: "test-v1",
    expiresAt: null,
    storage: "memory",
    routes: ["*"],
    clickIds: true,
    adCookies: false,
    sourceFields: { query: ["campaign_click"], cookies: [] },
  };
  assert.deepEqual(
    collect.minimizeSourceEvidence(body.sourceEvidence, policy),
    {
      query: [{ name: "campaign_click", value: "click-1" }],
      cookies: [],
    },
  );
  assert.equal(
    collect.permitted({ ...policy, sourceFields: undefined }),
    false,
  );
});

test("Next installation metadata stays exact", () => {
  assert.equal(INSTALLATION_VERIFICATION_ADAPTER_ID, "next_app_router");
  assert.equal(
    normalizeInstallationVerificationConfig({
      schemaVersion: "fonte.installation_verification.v2",
      installationAttemptId: "10000000-0000-4000-8000-000000000003",
      sdkVersion: "0.1.0",
      configVersion: "fonte.config.v2",
      adapterId: "next_app_router",
      adapterVersion: "v1",
    })?.adapterId,
    "next_app_router",
  );
});

const parseInput = (sourceEvidence) =>
  collect.parse(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ ...validBody, sourceEvidence }),
    }),
  );
test("bounded evidence rejects duplicates, excess fields and arbitrary values", async () => {
  for (const sourceEvidence of [
    undefined,
    null,
    { query: [], cookies: [], raw: {} },
    {
      query: [
        { name: "click", value: "one" },
        { name: "click", value: "two" },
      ],
      cookies: [],
    },
    {
      query: Array.from({ length: 9 }, (_, n) => ({
        name: `click${n}`,
        value: "id",
      })),
      cookies: [],
    },
    {
      query: [],
      cookies: Array.from({ length: 3 }, (_, n) => ({
        name: `cookie${n}`,
        value: "id",
      })),
    },
    { query: [{ name: "click", value: "person@example.test" }], cookies: [] },
    { query: [{ name: "click", value: "x".repeat(501) }], cookies: [] },
    { query: [{ name: "click", value: { arbitrary: "json" } }], cookies: [] },
    { query: [{ name: "click", value: "id", future: "extra" }], cookies: [] },
  ])
    assert.equal(await parseInput(sourceEvidence), null);
  const parsed = await parseInput({
    query: [
      { name: "z_click", value: "z" },
      { name: "a_click", value: "a" },
    ],
    cookies: [],
  });
  assert.deepEqual(parsed.sourceEvidence.query, [
    { name: "a_click", value: "a" },
    { name: "z_click", value: "z" },
  ]);
});
