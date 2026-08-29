import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("complete normalized URL identity isolates equal 1,000-character prefixes", async () => {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const sharedPrefix = `https://example.test/${"a".repeat(1_100)}`;
  const firstUrl = `${sharedPrefix}-first`;
  const secondUrl = `${sharedPrefix}-second`;
  assert.equal(firstUrl.slice(0, 1_000), secondUrl.slice(0, 1_000));
  const requests = [];
  const stored = new Map();
  const storageKeys = [];
  globalThis.window = {
    location: { href: firstUrl, pathname: new URL(firstUrl).pathname },
    localStorage: { getItem: () => null, setItem: () => undefined },
    sessionStorage: {
      getItem: (key) => {
        storageKeys.push(key);
        return stored.get(key) ?? null;
      },
      setItem: (key, value) => stored.set(key, value),
    },
  };
  globalThis.document = { referrer: "", cookie: "" };
  globalThis.fetch = async (_path, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length <= 2) throw new Error("ambiguous network loss");
    return { ok: true, status: 202, json: async () => null };
  };
  try {
    const capture = createCapture({
      storage: "long-url-isolation",
      capturePolicy: { mode: "all" },
      collectionPosture,
    });
    await capture.page();
    globalThis.window.location.href = secondUrl;
    globalThis.window.location.pathname = new URL(secondUrl).pathname;
    const second = await capture.page();

    assert.equal(requests.length, 4);
    assert.equal(
      second.deliveries.every(({ status }) => status === "delivered"),
      true,
    );
    assert.notEqual(requests[0].eventId, requests[2].eventId);
    assert.notEqual(requests[1].eventId, requests[3].eventId);
    assert.equal(new Set(storageKeys).size, 4);
    assert.equal(
      storageKeys.every((key) => /:pending-v2:[a-f0-9]{64}$/.test(key)),
      true,
    );
    assert.equal(
      storageKeys.some((key) => key.includes(sharedPrefix)),
      false,
    );
  } finally {
    globalThis.window = originals.window;
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
  }
});

test("public docs state the browser retry and storage boundary", async () => {
  const docs = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/core/README.md", import.meta.url), "utf8"),
  ]);
  for (const doc of docs) {
    assert.match(doc, /installation-scoped namespace/);
    assert.match(doc, /same-origin application path/);
    assert.match(doc, /page\(\).*never implicitly resends pending work/);
    assert.match(doc, /retry\(\).*explicit ambiguous-result retry boundary/);
    assert.match(doc, /best-effort browser\s+convenience only/);
    assert.match(doc, /current page lifetime/);
    assert.match(
      doc,
      /not durable authority or cross-reload exactly-once proof/,
    );
  }
});
