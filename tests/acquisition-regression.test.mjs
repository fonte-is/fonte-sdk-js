import assert from "node:assert/strict";
import test from "node:test";
import { createCapture } from "@fonte-is/core";
import { collect } from "@fonte-is/core/server";
const policy = () => ({
  status: "granted",
  version: "test-policy-v1",
  expiresAt: Date.now() + 60000,
  storage: "memory",
  routes: ["/"],
  clickIds: true,
  adCookies: true,
});
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
};
async function browser(run, { blockedStorage = false, reply } = {}) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const requests = [];
  globalThis.window = {
    location: new URL("https://example.test/"),
    localStorage: storage(),
    sessionStorage: storage(),
  };
  if (blockedStorage)
    for (const k of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, k, {
        get() {
          throw Error("storage denied");
        },
      });
  globalThis.document = { referrer: "", cookie: "" };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return reply
      ? reply(body, requests.length)
      : Response.json({
          disposition: "accepted",
          eventId: body.eventId,
          recordId: body.eventId,
          receivedAt: new Date().toISOString(),
        });
  };
  try {
    await run(requests);
  } finally {
    Object.assign(globalThis, saved);
  }
}
test("same occurrence is stable; another arrival at same URL is distinct", () =>
  browser(async (requests) => {
    const capture = createCapture({
      storage: "visits",
      collectionPolicy: policy,
    });
    await capture.page();
    await capture.page();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].occurrenceId, requests[1].occurrenceId);
    assert.notEqual(requests[0].eventId, requests[1].eventId);
    await capture.page({ navigation: true });
    assert.equal(requests.length, 4);
    assert.notEqual(requests[0].occurrenceId, requests[2].occurrenceId);
  }));
test("lost response and unavailable storage preserve direct snapshot ID payload and time", () =>
  browser(
    async (requests) => {
      const capture = createCapture({
        storage: "retry",
        collectionPolicy: policy,
      });
      await capture.page();
      window.location = new URL("https://example.test/?twclid=changed");
      document.cookie = "_fbc=changed";
      await capture.retry();
      assert.equal(requests.length, 4);
      assert.deepEqual(requests.slice(0, 2), requests.slice(2));
    },
    {
      blockedStorage: true,
      reply() {
        throw Error("lost response");
      },
    },
  ));
test("ignored response is not durable acceptance", () =>
  browser(
    async () => {
      const capture = createCapture({
        storage: "ignored",
        collectionPolicy: policy,
      });
      const result = await capture.page();
      assert.ok(result.deliveries.every((x) => x.status !== "delivered"));
    },
    { reply: () => Response.json({ disposition: "ignored" }) },
  ));
test("unknown policy touches no storage cookies or transport", () =>
  browser(
    async (requests) => {
      Object.defineProperty(document, "cookie", {
        get() {
          throw Error("prohibited cookie read");
        },
      });
      const result = await createCapture({ storage: "unknown" }).page();
      assert.equal(requests.length, 0);
      assert.equal(result.deliveries[0].reason, "collection_not_permitted");
    },
    { blockedStorage: true },
  ));
test("X referral outranks inherited Meta cookies; missing referrer stays unknown", () => {
  const x = collect.classifySourceTouch({
    current_url: "https://example.test/",
    referrer: "https://t.co/link",
    fbc: "old",
    fbp: "old",
  });
  assert.equal(x.sourcePlatform, "x");
  assert.equal(x.channelType, "organic");
  assert.notEqual(
    collect.classifySourceTouch({
      current_url: "https://example.test/",
      referrer: "https://x.com.attacker.test/",
    }).sourcePlatform,
    "x",
  );
  assert.equal(
    collect.classifySourceTouch({ current_url: "https://example.test/" })
      .sourcePlatform,
    "unknown",
  );
  const touch = collect.toTouch(
    { twclid: "x-click", ttclid: "tiktok-click" },
    "browser",
  );
  assert.equal(touch.twclid, "x-click");
  assert.equal(touch.ttclid, "tiktok-click");
});

test("policy withdrawal prevents pending replay and clears memory identity", () =>
  browser(
    async (requests) => {
      let enabled = true;
      const capture = createCapture({
        storage: "withdraw",
        collectionPolicy: () => (enabled ? policy() : null),
      });
      await capture.page();
      const oldJourney = requests[0].journeyId;
      enabled = false;
      await capture.retry();
      await capture.page();
      assert.equal(requests.length, 2);
      enabled = true;
      await capture.page();
      assert.notEqual(requests[2].journeyId, oldJourney);
    },
    {
      reply() {
        throw Error("unavailable");
      },
    },
  ));
test("frozen snapshot has only admitted fields and referral origin", () =>
  browser(async (requests) => {
    window.location = new URL(
      "https://example.test/?utm_source=fake-secret@example.test&twclid=ok-click&access_token=planted-secret",
    );
    document.referrer = "https://x.com/private/path?token=planted-secret";
    await createCapture({
      storage: "redaction",
      collectionPolicy: policy,
    }).page();
    const serialized = JSON.stringify(requests);
    assert.ok(!serialized.includes("planted-secret"));
    assert.ok(!serialized.includes("fake-secret"));
    assert.ok(!serialized.includes("/private/path"));
    assert.equal(requests[0].scope.twclid, "ok-click");
    assert.equal(requests[0].scope.referrer, "https://x.com");
  }));
test("retry stops after the bounded number of attempts", () =>
  browser(
    async (requests) => {
      const capture = createCapture({
        storage: "bounds",
        collectionPolicy: policy,
      });
      await capture.page();
      await capture.retry();
      await capture.retry();
      await capture.retry();
      await capture.retry();
      assert.equal(requests.length, 6);
    },
    {
      reply() {
        throw Error("offline");
      },
    },
  ));
test("bounded parser cancels an oversized streaming request before reading the rest", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await collect.parse(
    new Request("https://example.test", {
      method: "POST",
      duplex: "half",
      body: stream,
    }),
    { maxBytes: 100 },
  );
  assert.equal(result, null);
  assert.ok(cancelled);
  assert.ok(reads <= 2);
});
test("source link identity does not replace observed referrer", () => {
  const c = collect.classifySourceTouch({
    fonte: "opaque-issued-link",
    current_url: "https://example.test/",
    referrer: "https://elsewhere.example.test",
  });
  assert.equal(c.sourcePlatform, "elsewhere.example.test");
  assert.equal(c.channelType, "referral");
});

test("renewing policy expiry cannot extend an existing pending snapshot", () =>
  browser(
    async (requests) => {
      const now = Date.now;
      let time = now();
      Date.now = () => time;
      try {
        const approved = { ...policy(), expiresAt: time + 1000 };
        const capture = createCapture({
          storage: "expiry",
          collectionPolicy: () => approved,
        });
        await capture.page();
        time += 1001;
        approved.expiresAt = time + 60000;
        const retried = await capture.retry();
        assert.equal(requests.length, 2);
        assert.ok(
          retried.deliveries.every((item) => item.reason === "expired"),
        );
      } finally {
        Date.now = now;
      }
    },
    {
      reply() {
        throw Error("lost response");
      },
    },
  ));

test("concurrent retry does not overlap an active attempt and reset invalidates its response", () => {
  const finish = [];
  return browser(
    async (requests) => {
      const capture = createCapture({
        storage: "concurrent",
        collectionPolicy: policy,
      });
      const first = capture.page();
      const retried = await capture.retry();
      assert.equal(requests.length, 2);
      assert.ok(
        retried.deliveries.every((item) => item.reason === "in_flight"),
      );
      capture.reset();
      for (const [body, resolve] of finish)
        resolve(
          Response.json({
            disposition: "accepted",
            eventId: body.eventId,
            recordId: body.eventId,
            receivedAt: new Date().toISOString(),
          }),
        );
      assert.ok(
        (await first).deliveries.every((item) => item.status !== "delivered"),
      );
    },
    { reply: (body) => new Promise((resolve) => finish.push([body, resolve])) },
  );
});

test("malformed collection options cannot grant cookie or arbitrary campaign access", () => {
  for (const extra of [
    { adCookies: "false" },
    { campaignValues: { utm_source: "anything" } },
    { campaignValues: { utm_source: ["person@example.test"] } },
  ]) {
    assert.equal(collect.permitted({ ...policy(), ...extra }), false);
  }
});

test("explicit reset after a document reload erases owned persistent continuity", () =>
  browser(async (requests) => {
    const approved = () => ({ ...policy(), storage: "persistent" });
    await createCapture({
      storage: "logout",
      collectionPolicy: approved,
    }).page();
    const original = requests[0].journeyId;
    // A fresh capture has not read persistent state yet, as after a full logout redirect.
    createCapture({ storage: "logout" }).reset();
    await createCapture({
      storage: "logout",
      collectionPolicy: approved,
    }).page();
    assert.notEqual(requests[2].journeyId, original);
  }));
