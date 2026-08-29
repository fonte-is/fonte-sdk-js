import assert from "node:assert/strict";
import test from "node:test";

import { createCapture } from "@fonte-is/core";

const deniedStorage = {
  getItem: () => {
    throw new Error("storage denied");
  },
  setItem: () => {
    throw new Error("storage denied");
  },
};

const collectionPosture = {
  runtime: {
    schemaVersion: "fonte.collection_posture_browser.v0",
    collectionMode: "privacy_safe",
    policyVersion: "10000000-0000-4000-8000-000000000010",
    effectiveAt: "2026-08-29T00:00:00.000Z",
    visitorChoiceRequired: false,
  },
};

test("storage-denied ambiguity retains one exact attempt until terminal delivery", async () => {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const requests = [];
  const persistentWrites = [];
  globalThis.window = {
    location: {
      href: "https://example.test/storage-denied?utm_source=newsletter",
      pathname: "/storage-denied",
    },
    localStorage: {
      getItem: () => null,
      setItem: (key, value) => persistentWrites.push([key, value]),
    },
    sessionStorage: deniedStorage,
  };
  globalThis.document = { referrer: "", cookie: "" };
  globalThis.fetch = async (_path, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length <= 2) throw new Error("ambiguous network loss");
    return { ok: true, status: 202, json: async () => null };
  };
  try {
    const capture = createCapture({
      storage: "storage-denied-retry",
      capturePolicy: { mode: "all" },
      collectionPosture,
    });
    const ambiguous = await capture.page();
    assert.deepEqual(
      ambiguous.deliveries.map(({ status, reason }) => [status, reason]),
      [
        ["failed", "network_error"],
        ["failed", "network_error"],
      ],
    );

    const implicitRetry = await capture.page();
    assert.deepEqual(
      implicitRetry.deliveries.map(({ status, reason }) => [status, reason]),
      [
        ["skipped", "in_flight"],
        ["skipped", "in_flight"],
      ],
    );
    assert.equal(requests.length, 2);

    const retried = await capture.retry();
    assert.equal(
      retried.deliveries.every(({ status }) => status === "delivered"),
      true,
    );
    assert.equal(requests[0].eventId, requests[2].eventId);
    assert.equal(requests[1].eventId, requests[3].eventId);
    assert.equal(requests[0].occurredAt, requests[2].occurredAt);
    assert.equal(requests[1].occurredAt, requests[3].occurredAt);
    assert.notEqual(requests[0].eventId, requests[1].eventId);

    const completed = await capture.retry();
    assert.equal(
      completed.deliveries.every(
        ({ status, reason }) => status === "skipped" && reason === "duplicate",
      ),
      true,
    );
    assert.equal(requests.length, 4);

    globalThis.window.location.href =
      "https://example.test/storage-denied-next?utm_source=newsletter";
    globalThis.window.location.pathname = "/storage-denied-next";
    const isolated = await capture.page();
    assert.equal(
      isolated.deliveries.every(({ status }) => status === "delivered"),
      true,
    );
    assert.equal(requests.length, 6);
    assert.notEqual(requests[0].eventId, requests[4].eventId);
    assert.notEqual(requests[1].eventId, requests[5].eventId);
    assert.deepEqual(persistentWrites, []);
  } finally {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  }
});
