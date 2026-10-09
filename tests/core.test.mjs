import assert from "node:assert/strict";
import test from "node:test";

import { createCapture } from "@fonte-is/core";
import {
  FONTE_CONFIG_VERSION,
  INSTALLATION_VERIFICATION_SCHEMA_VERSION,
  INSTALLATION_VERIFICATION_SDK_VERSION,
  normalizeInstallationVerification,
} from "@fonte-is/core/installation-verification";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test("Core installation metadata contracts stay versioned", () => {
  assert.equal(INSTALLATION_VERIFICATION_SDK_VERSION, "0.2.0");
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
      sdkVersion: "0.2.0",
      configVersion: "fonte.config.v2",
    },
  );
  assert.equal(
    normalizeInstallationVerification({
      schemaVersion: "fonte.installation_verification.v2",
      installationAttemptId: "10000000-0000-4000-8000-000000000001",
      sdkVersion: "0.1.0",
      configVersion: "fonte.config.v2",
    }),
    null,
  );
});

test("browser capture starts only with permitted policy", async () => {
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
    return Response.json(
      {
        disposition: "accepted",
        eventId: requests.at(-1).body.eventId,
        recordId: "receipt",
        receivedAt: new Date().toISOString(),
      },
      { status: 202 },
    );
  };
  try {
    const capture = createCapture({
      storage: "browser-test",
      collectionPolicy: () => ({
        status: "granted",
        version: "test-v1",
        expiresAt: Date.now() + 60000,
        storage: "memory",
        routes: ["/start"],
      }),
      verification: {
        schemaVersion: "fonte.installation_verification.v2",
        installationAttemptId: "10000000-0000-4000-8000-000000000002",
        sdkVersion: "0.2.0",
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
    assert.deepEqual(Object.keys(capture).sort(), ["page", "reset", "retry"]);
    assert.equal(requests[0].body.verification, undefined);
    assert.equal(requests[1].body.verification.sdkVersion, "0.2.0");
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
      ? Response.json({ disposition: "unavailable" }, { status: 503 })
      : Response.json(
          {
            disposition: "accepted",
            eventId: requests.at(-1).eventId,
            recordId: "receipt",
            receivedAt: new Date().toISOString(),
          },
          { status: 202 },
        );
  };
  try {
    const capture = createCapture({
      storage: "retry-test",
      collectionPolicy: () => ({
        status: "granted",
        version: "test-v1",
        expiresAt: Date.now() + 60000,
        storage: "memory",
        routes: ["/retry"],
      }),
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
