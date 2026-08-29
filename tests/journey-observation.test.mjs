import assert from "node:assert/strict";
import test from "node:test";

import { createCapture } from "@fonte-is/core";
import { collect, createClient } from "@fonte-is/core/server";

const policyVersion = "10000000-0000-4000-8000-000000000010";
const occurredAt = "2026-08-29T00:00:00.000Z";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const runtime = (collectionMode, visitorChoiceRequired = false) => ({
  schemaVersion: "fonte.collection_posture_browser.v0",
  collectionMode,
  policyVersion,
  effectiveAt: occurredAt,
  visitorChoiceRequired,
});

const privacyBody = () => ({
  schemaVersion: "fonte.browser_touch_observation.v1",
  eventId: "10000000-0000-4000-8000-000000000001",
  eventType: "source_touch",
  occurredAt,
  journeyIdentityScope: "event_ephemeral",
  collectionPostureObservation: {
    schemaVersion: "fonte.collection_posture_observation.v0",
    visitorChoice: "not_present",
    policyVersion,
  },
  scope: {
    current_url:
      "https://example.test/landing?utm_source=newsletter&utm_campaign=spring&secret=drop",
    canonical_route: "/landing",
    utm_source: "newsletter",
    utm_campaign: "spring",
  },
});

test("capture fails closed when collection posture or managed choice is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected network call");
  };
  try {
    const missing = await createCapture({ storage: "missing-posture" }).page();
    assert.deepEqual(
      missing.deliveries.map(({ status, reason }) => [status, reason]),
      [
        ["unavailable", "collection_posture_unavailable"],
        ["unavailable", "collection_posture_unavailable"],
      ],
    );
    const managed = await createCapture({
      storage: "missing-choice",
      collectionPosture: {
        runtime: runtime("consent_managed", true),
      },
    }).page();
    assert.equal(
      managed.deliveries.every(
        ({ status, reason }) =>
          status === "unavailable" && reason === "visitor_choice_unavailable",
      ),
      true,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("privacy-safe capture sends typed event-scoped observations and reports withheld", async () => {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const bodies = [];
  const persistentWrites = [];
  globalThis.window = {
    location: {
      href: "https://example.test/landing?utm_source=newsletter&utm_campaign=spring&fbclid=drop&secret=drop",
      pathname: "/landing",
    },
    localStorage: {
      getItem: () => null,
      setItem: (key, value) => persistentWrites.push([key, value]),
    },
    sessionStorage: memoryStorage(),
  };
  globalThis.document = {
    referrer: "https://referrer.test/path?secret=drop",
    cookie: "_fbp=drop",
  };
  globalThis.fetch = async (_path, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 202,
      json: async () => ({
        blocked: true,
        reason: "collection_policy_withholds",
      }),
    };
  };
  try {
    const result = await createCapture({
      storage: "privacy-safe",
      capturePolicy: { mode: "all" },
      collectionPosture: { runtime: runtime("privacy_safe") },
    }).page();
    assert.equal(bodies.length, 2);
    assert.deepEqual(persistentWrites, []);
    for (const body of bodies) {
      assert.ok(
        await collect.parse(
          new Request("https://example.test", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        ),
      );
      assert.equal(body.schemaVersion, "fonte.browser_touch_observation.v1");
      assert.equal(body.journeyIdentityScope, "event_ephemeral");
      assert.equal(body.journeyId, undefined);
      assert.equal(body.scope.fonte_device_id, undefined);
      assert.equal(body.scope.fonte_journey_id, undefined);
      assert.equal(body.scope.fbclid, undefined);
      assert.equal(body.scope.fbp, undefined);
      assert.equal(body.scope.utm_source, "newsletter");
      assert.equal(body.scope.utm_campaign, "spring");
      assert.equal(body.scope.current_url, "https://example.test/landing");
      assert.equal(body.scope.referrer, "https://referrer.test/path");
    }
    assert.equal(
      result.deliveries.every(
        ({ status, reason }) =>
          status === "withheld" && reason === "collection_policy_withholds",
      ),
      true,
    );
  } finally {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  }
});

test("parser binds exact schema, source parameters, identity scope, and size", async () => {
  const parse = (body) =>
    collect.parse(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  const accepted = await parse(privacyBody());
  assert.ok(accepted);
  assert.equal(accepted.journeyId, undefined);
  assert.equal(accepted.scope.current_url, "https://example.test/landing");

  const inventedCampaign = privacyBody();
  inventedCampaign.scope.utm_source = "invented";
  assert.equal(await parse(inventedCampaign), null);

  const unknown = privacyBody();
  unknown.unknown = true;
  assert.equal(await parse(unknown), null);

  const persistentWithoutJourney = privacyBody();
  persistentWithoutJourney.journeyIdentityScope = "persistent_first_party";
  assert.equal(await parse(persistentWithoutJourney), null);

  const oversized = privacyBody();
  oversized.scope.utm_campaign = "x".repeat(20_000);
  assert.equal(await parse(oversized), null);
});

test("accepted observation maps once to the existing Control Plane contract", async () => {
  const originalFetch = globalThis.fetch;
  const body = await collect.parse(
    new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify(privacyBody()),
    }),
  );
  assert.ok(body);
  const scope = collect.acceptScope(body.scope, {
    siteUrl: "https://example.test",
    requestOrigin: "https://example.test",
    userAgent: "Synthetic Browser",
  });
  assert.ok(scope);
  const input = collect.toTouchInput(body, scope, "next_app_router");
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      status: 202,
      json: async () => ({ blocked: true, reason: "visitor_choice_denies" }),
    };
  };
  try {
    const client = createClient({
      baseUrl: "https://api.example.test",
      tenantId: "10000000-0000-4000-8000-000000000020",
      tenantApiKey: "test-key-with-at-least-24-characters",
    });
    assert.deepEqual(await client.touch(input), {
      blocked: true,
      reason: "visitor_choice_denies",
    });
    assert.equal(sent.logicalEventId, body.eventId);
    assert.equal(sent.idempotencyKey, body.eventId);
    assert.equal(sent.occurredAt, body.occurredAt);
    assert.equal(sent.touch.journeyId, body.eventId);
    assert.equal(sent.touch.journeyIdentityScope, "event_ephemeral");
    assert.deepEqual(
      sent.rawPayload.collectionPostureObservation,
      body.collectionPostureObservation,
    );
    assert.equal(
      sent.rawPayload.browserObservation.scope.current_url.includes("?"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server reads only the exact non-secret runtime posture receipt", async () => {
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (url, init) => {
    received = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => runtime("privacy_safe"),
    };
  };
  try {
    const client = createClient({
      baseUrl: "https://api.example.test",
      tenantId: "10000000-0000-4000-8000-000000000020",
      tenantApiKey: "test-key-with-at-least-24-characters",
    });
    assert.equal(
      (await client.collectionPosture()).collectionMode,
      "privacy_safe",
    );
    assert.equal(received.init.method, "GET");
    assert.equal(
      received.url.includes("tenantId=10000000-0000-4000-8000-000000000020"),
      true,
    );
    assert.equal(received.url.includes("environment=production"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
