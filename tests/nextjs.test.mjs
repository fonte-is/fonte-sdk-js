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
  schemaVersion: "fonte.browser_touch_observation.v1",
  eventId: "10000000-0000-4000-8000-000000000001",
  eventType: "source_touch",
  occurredAt: "2026-08-29T00:00:00.000Z",
  journeyId: "10000000-0000-4000-8000-000000000002",
  journeyIdentityScope: "persistent_first_party",
  collectionPostureObservation: {
    schemaVersion: "fonte.collection_posture_observation.v0",
    visitorChoice: "not_present",
    policyVersion: "10000000-0000-4000-8000-000000000010",
  },
  scope: {
    fonte_journey_id: "10000000-0000-4000-8000-000000000002",
    canonical_route: "/launch",
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

test("Next maps an accepted scope to the Core touch payload", async () => {
  const body = await collect.parse(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(validBody),
    }),
  );
  assert.ok(body);
  assert.deepEqual(collect.classifySourceTouch(body.scope), {
    channelType: "unknown",
    channel: "unknown",
    sourcePlatform: "demo",
    captureReason: "utm_parameter",
  });
  const touch = collect.toTouch(body.scope, body.journeyId);
  assert.equal(touch.journeyId, body.journeyId);
  assert.equal(touch.platform, "other");
  assert.equal(touch.isPaid, false);
  assert.equal(touch.sourcePlatform, "demo");
});

test("Core source classification keeps each reported-signal branch explicit", () => {
  const cases = [
    {
      scope: { gclid: "click-1" },
      expected: ["paid", "paid_search", "google", "platform_click_id"],
    },
    {
      scope: { fbclid: "click-2" },
      expected: ["paid", "paid_social", "meta", "platform_click_id"],
    },
    {
      scope: { fonte: "source-token" },
      expected: ["unknown", "unknown", "fonte", "fonte_source_identity"],
    },
    {
      scope: { utm_source: "newsletter", utm_medium: "email" },
      expected: ["owned", "owned_email", "newsletter", "utm_parameter"],
    },
    {
      scope: { utm_source: "google", utm_medium: "organic" },
      expected: ["organic", "organic_search", "google", "utm_parameter"],
    },
    {
      scope: {
        current_url: "https://example.test/page",
        referrer: "https://referrer.example/path",
      },
      expected: [
        "referral",
        "referral",
        "referrer.example",
        "external_referrer",
      ],
    },
    {
      scope: { current_url: "https://example.test/page" },
      expected: ["direct", "direct", "direct", "direct_landing"],
    },
  ];

  for (const { scope, expected } of cases) {
    const result = collect.classifySourceTouch(scope);
    assert.deepEqual(
      [
        result.channelType,
        result.channel,
        result.sourcePlatform,
        result.captureReason,
      ],
      expected,
    );
  }
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
