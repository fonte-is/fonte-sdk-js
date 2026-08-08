import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCapture } from "@fonte-is/core";
import {
  FONTE_CONFIG_VERSION,
  INSTALLATION_VERIFICATION_SCHEMA_VERSION,
  INSTALLATION_VERIFICATION_SDK_VERSION,
  normalizeInstallationVerification,
} from "@fonte-is/core/installation-verification";
import { createClient } from "@fonte-is/core/server";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const touchContract = JSON.parse(
  await readFile(
    new URL("./fixtures/v1-touches-contract.json", import.meta.url),
    "utf8",
  ),
);

test("Core installation metadata contracts stay versioned", () => {
  assert.deepEqual(
    normalizeInstallationVerification({
      schemaVersion: INSTALLATION_VERIFICATION_SCHEMA_VERSION,
      installationAttemptId: "10000000-0000-4000-8000-000000000001",
      sdkVersion: INSTALLATION_VERIFICATION_SDK_VERSION,
      configVersion: FONTE_CONFIG_VERSION,
    }),
    {
      schemaVersion: "fonte.installation_verification.v2",
      installationAttemptId: "10000000-0000-4000-8000-000000000001",
      sdkVersion: "0.1.0",
      configVersion: "fonte.config.v2",
    },
  );
});

test("browser capture starts immediately", async () => {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const requests = [];
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  globalThis.window = {
    location: {
      href: "https://example.test/start?utm_source=demo&utm_medium=paid_social&secret=drop",
      pathname: "/start",
    },
    localStorage,
    sessionStorage,
    dispatchEvent() {},
  };
  globalThis.document = { referrer: "", cookie: "" };
  globalThis.fetch = async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body) });
    return { ok: true, status: 202 };
  };
  try {
    const capture = createCapture({
      storage: "browser-test",
      verification: {
        schemaVersion: "fonte.installation_verification.v2",
        installationAttemptId: "10000000-0000-4000-8000-000000000002",
        sdkVersion: "0.1.0",
        configVersion: "fonte.config.v2",
      },
    });
    const delivered = await capture.page();
    assert.deepEqual(
      requests.map(({ path, body }) => [path, body.eventType]),
      [
        ["/api/fonte/collect", "page_view"],
        ["/api/fonte/collect", "source_touch"],
      ],
    );
    assert.equal(requests[0].body.scope.current_url.includes("secret="), false);
    assert.deepEqual(Object.keys(capture).sort(), ["page", "retry"]);
    assert.equal(requests[0].body.verification, undefined);
    assert.equal(requests[1].body.verification.sdkVersion, "0.1.0");
    assert.deepEqual(
      delivered.deliveries.map(({ status, httpStatus }) => [
        status,
        httpStatus,
      ]),
      [
        ["delivered", 202],
        ["delivered", 202],
      ],
    );
  } finally {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  }
});

test("browser capture reports failures, retries stable event IDs, and deduplicates", async () => {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const requests = [];
  const deliveries = [];
  globalThis.window = {
    location: {
      href: "https://example.test/retry?utm_source=demo",
      pathname: "/retry",
    },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  };
  globalThis.document = { referrer: "", cookie: "" };
  globalThis.fetch = async (_path, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length <= 2
      ? { ok: false, status: 503 }
      : { ok: true, status: 202 };
  };
  try {
    const capture = createCapture({
      storage: "retry-test",
      onDelivery: (delivery) => deliveries.push(delivery),
    });
    const failed = await capture.page();
    assert.deepEqual(
      failed.deliveries.map(({ status, reason }) => [status, reason]),
      [
        ["failed", "http_error"],
        ["failed", "http_error"],
      ],
    );
    const retried = await capture.retry();
    assert.equal(
      retried.deliveries.every(({ status }) => status === "delivered"),
      true,
    );
    assert.equal(requests[0].eventId, requests[2].eventId);
    assert.equal(requests[1].eventId, requests[3].eventId);
    const duplicate = await capture.page();
    assert.equal(
      duplicate.deliveries.every(
        ({ status, reason }) => status === "skipped" && reason === "duplicate",
      ),
      true,
    );
    assert.equal(deliveries.length, 6);
  } finally {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  }
});

test("server client writes only through POST /v1/touches", async () => {
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (url, init) => {
    received = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ recordId: "touch-1" }) };
  };
  try {
    const client = createClient({
      baseUrl: "https://api.example.test",
      tenantId: "10000000-0000-4000-8000-000000000006",
      tenantApiKey: "test-key-with-at-least-24-characters",
    });
    const result = await client.touch({
      idempotencyKey: "touch-demo-1",
      occurredAt: "2026-08-08T12:00:00Z",
      source: "next_app_router",
      requestOrigin: "https://example.test",
      eventId: "10000000-0000-4000-8000-000000000003",
      event: "source_touch",
      raw: {
        source: "sdk-contract-fixture",
      },
      touch: {
        journeyId: "10000000-0000-4000-8000-000000000004",
        platform: "meta",
        isPaid: true,
        utmSource: "demo",
        utmMedium: "paid_social",
        utmCampaign: "launch",
        utmContent: "hero",
        utmTerm: "example",
        fonteLinkToken: "fl_demo",
        channelType: "paid",
        sourcePlatform: "meta",
        referrer: "https://referrer.example.test/",
        landingUrl: "https://example.test/launch",
        gclid: "gclid-demo",
        gbraid: "gbraid-demo",
        wbraid: "wbraid-demo",
        fbclid: "fbclid-demo",
        fbc: "fbc-demo",
        fbp: "fbp-demo",
        clientUserAgent: "Synthetic Browser",
        unexpectedProviderField: "drop",
      },
    });
    assert.equal(received.url, "https://api.example.test/v1/touches");
    assert.equal(received.init.method, "POST");
    assert.equal(received.init.headers.Origin, "https://example.test");
    assert.equal(received.body.sourceSystem, "next_app_router");
    assert.deepEqual(
      Object.keys(received.body).sort(),
      touchContract.sdkSerializedTopLevelFields,
    );
    assert.equal(
      touchContract.sdkSerializedTopLevelFields.every((field) =>
        touchContract.controlPlaneTopLevelFields.includes(field),
      ),
      true,
    );
    assert.deepEqual(
      Object.keys(received.body.touch).sort(),
      touchContract.touchFields,
    );
    assert.equal(received.body.touch.unexpectedProviderField, undefined);
    assert.equal(
      touchContract.controlPlaneCommit,
      "43fa22a056665424278d8db3a7bcf2ff3430f8f5",
    );
    assert.equal(touchContract.route, "/v1/touches");
    assert.deepEqual(result, { recordId: "touch-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server client rejects missing credentials and production Origin", async () => {
  assert.throws(
    () => createClient({ tenantApiKey: "short" }),
    /at least 24 characters/,
  );
  const client = createClient({
    tenantApiKey: "test-key-with-at-least-24-characters",
  });
  await assert.rejects(
    client.touch({
      idempotencyKey: "touch-demo-2",
      occurredAt: "2026-08-08T12:00:00Z",
      source: "test",
      touch: {
        journeyId: "10000000-0000-4000-8000-000000000005",
        platform: "other",
        isPaid: false,
      },
    }),
    /request_origin_required/,
  );
});
