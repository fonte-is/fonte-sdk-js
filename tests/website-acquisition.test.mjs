import assert from "node:assert/strict";
import { test } from "node:test";
import { createCapture } from "@fonte-is/core";
import { collect } from "@fonte-is/core/server";
import { createWebsiteAcquisition } from "../packages/core/dist/website/acquisition.js";

const siteId = "site_0123456789abcdef";
const policy = (extra = {}) => ({
  status: "granted",
  version: "website-test-v1",
  expiresAt: null,
  storage: "memory",
  routes: ["*"],
  clickIds: true,
  adCookies: true,
  sourceTokens: true,
  campaignValues: true,
  ...extra,
});
const accepted = (body, extra = {}) => ({
  disposition: "accepted",
  eventId: body.eventId,
  recordId: `record-${body.eventId}`,
  receivedAt: "2026-09-26T00:00:00.000Z",
  ...extra,
});
async function host(
  run,
  {
    href = "https://website.example/",
    referrer = "",
    cookies = "",
    blocked = false,
    reply,
  } = {},
) {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const crypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalDate = Date.now;
  let now = originalDate();
  Date.now = () => now;
  let uuidCalls = 0,
    sourceReads = 0,
    cookieReads = 0,
    storageReads = 0,
    storageWrites = 0,
    erasures = 0;
  const savedValues = new Map();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID() {
        uuidCalls++;
        return `00000000-0000-4000-8000-${String(uuidCalls).padStart(12, "0")}`;
      },
    },
  });
  const requests = [];
  const network = [];
  const storage = {
    getItem(key) {
      storageReads++;
      if (blocked) throw Error("storage blocked");
      return savedValues.get(key) ?? null;
    },
    setItem(key, value) {
      storageWrites++;
      if (blocked) throw Error("storage blocked");
      savedValues.set(key, value);
    },
    removeItem(key) {
      erasures++;
      if (blocked) throw Error("storage blocked");
      savedValues.delete(key);
    },
  };
  let location = new URL(href);
  globalThis.window = { localStorage: storage, sessionStorage: storage };
  Object.defineProperty(window, "location", {
    get() {
      sourceReads++;
      return location;
    },
    set(value) {
      location = new URL(value);
    },
    configurable: true,
  });
  globalThis.document = {};
  Object.defineProperty(document, "referrer", {
    get() {
      sourceReads++;
      return referrer;
    },
    configurable: true,
  });
  Object.defineProperty(document, "cookie", {
    get() {
      cookieReads++;
      return cookies;
    },
    configurable: true,
  });
  const transport = async (body, signal) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    return reply
      ? reply(body, signal, requests.length)
      : { httpStatus: 200, receipt: accepted(body) };
  };
  globalThis.fetch = async (url, init) => {
    network.push({
      url,
      credentials: init.credentials,
      headers: init.headers,
      body: init.body,
    });
    const response = await transport(JSON.parse(init.body), init.signal);
    return Response.json(response.receipt, { status: response.httpStatus });
  };
  const metrics = () => ({
    uuidCalls,
    sourceReads,
    cookieReads,
    storageReads,
    storageWrites,
    erasures,
    requests: requests.length,
  });
  const make = (extra = {}) =>
    createWebsiteAcquisition({ siteId, transport, ...extra });
  try {
    return await run({
      make,
      requests,
      network,
      transport,
      metrics,
      savedValues,
      advance(ms) {
        now += ms;
      },
    });
  } finally {
    Date.now = originalDate;
    Object.assign(globalThis, saved);
    if (crypto) Object.defineProperty(globalThis, "crypto", crypto);
    else delete globalThis.crypto;
  }
}
const normalized = (requests) =>
  requests.map(({ occurredAt, ...body }) => body);

for (const fixture of [
  {
    name: "X source with inherited Meta cookies",
    href: "https://website.example/?twclid=x-click&fonte=source-token&utm_source=x&access_token=discarded",
    referrer: "https://t.co/link?private=discarded",
    cookies: "_fbc=old-meta; _fbp=old-meta",
  },
  { name: "missing referrer", href: "https://website.example/", referrer: "" },
  {
    name: "false X hostname",
    href: "https://website.example/?utm_campaign=campaign",
    referrer: "https://x.com.attacker.example/private",
  },
  {
    name: "minimized ad and campaign values",
    href: "https://website.example/?twclid=allowed-click&ttclid=tiktok-click&utm_source=person@example.test&fonte=token&secret=discarded",
    referrer: "https://elsewhere.example/private?secret=discarded",
    cookies: "_fbc=old-meta",
    approved: policy({
      clickIds: false,
      adCookies: false,
      sourceTokens: false,
      campaignValues: { utm_campaign: ["allowed"] },
    }),
  },
])
  test(`legacy/website fixture parity: ${fixture.name}`, async () => {
    const approved = fixture.approved ?? policy();
    const legacy = await host(async ({ requests, network }) => {
      const capture = createCapture({
        storage: "website:" + siteId,
        collectionPolicy: () => approved,
      });
      await capture.page();
      await capture.page();
      await capture.page({ navigation: true });
      assert(
        network.every(
          (entry) =>
            entry.url === "/api/fonte/collect" &&
            entry.credentials === "same-origin",
        ),
      );
      return normalized(requests);
    }, fixture);
    const website = await host(async ({ make, requests }) => {
      const acquisition = make();
      acquisition.setPolicy(approved);
      await acquisition.page();
      await acquisition.page();
      await acquisition.page({ navigation: true });
      acquisition.destroy();
      return normalized(requests);
    }, fixture);
    assert.deepEqual(website, legacy);
    assert.equal(website.length, 4);
    assert.equal(website[0].occurrenceId, website[1].occurrenceId);
    assert.notEqual(website[0].eventId, website[1].eventId);
    assert.notEqual(website[0].occurrenceId, website[2].occurrenceId);
    const classified = collect.classifySourceTouch(website[0].scope);
    if (fixture.name.startsWith("X source"))
      assert.equal(classified.sourcePlatform, "x");
    if (fixture.name === "missing referrer")
      assert.equal(classified.sourcePlatform, "unknown");
    if (fixture.name === "false X hostname")
      assert.notEqual(classified.sourcePlatform, "x");
    if (fixture.name.startsWith("minimized")) {
      assert.equal(website[0].scope.twclid, undefined);
      assert.equal(website[0].scope.fbc, undefined);
      assert.equal(website[0].scope.fonte, undefined);
      assert.equal(website[0].scope.utm_source, undefined);
      assert(!JSON.stringify(website).includes("discarded"));
    }
  });

test("no permitted policy means zero source, cookie, storage, identity or transport operations", () =>
  host(async ({ make, metrics }) => {
    const acquisition = make();
    for (const denied of [
      null,
      policy({ status: "unknown" }),
      policy({ status: "denied" }),
      policy({ expiresAt: 1 }),
      policy({ adCookies: "true" }),
    ]) {
      acquisition.setPolicy(denied);
      const page = await acquisition.page();
      await acquisition.retry();
      assert(
        page.deliveries.every(
          (delivery) => delivery.reason === "collection_not_permitted",
        ),
      );
    }
    acquisition.destroy();
    await acquisition.page();
    await acquisition.retry();
    assert.deepEqual(metrics(), {
      uuidCalls: 0,
      sourceReads: 0,
      cookieReads: 0,
      storageReads: 0,
      storageWrites: 0,
      erasures: 0,
      requests: 0,
    });
  }));

for (const blocked of [false, true])
  test(`persistent continuity uses site namespace and fallback, storage blocked=${blocked}`, () =>
    host(
      async ({ make, requests, savedValues }) => {
        const one = make();
        one.setPolicy(policy({ storage: "persistent" }));
        await one.page();
        const same = make();
        same.setPolicy(policy({ storage: "persistent" }));
        await same.page();
        if (!blocked)
          assert.equal(requests[0].journeyId, requests[2].journeyId);
        const two = make({ siteId: "site_abcdef0123456789" });
        two.setPolicy(policy({ storage: "persistent" }));
        await two.page();
        assert.notEqual(requests[0].journeyId, requests[4].journeyId);
        if (!blocked) {
          assert.deepEqual(
            [...savedValues.keys()].sort(),
            [
              `website:${siteId}:fonte-journey-v2`,
              "website:site_abcdef0123456789:fonte-journey-v2",
            ].sort(),
          );
          assert.equal(savedValues.has("fonte:fonte-journey-v2"), false);
        }
        one.destroy();
        same.destroy();
        two.destroy();
      },
      { blocked },
    ));

test("ordinary denied reset cleans owned storage once, legacy explicit reset still erases after reload", () =>
  host(async ({ make, metrics, savedValues }) => {
    const acquisition = make();
    acquisition.setPolicy(policy({ storage: "persistent" }));
    await acquisition.page();
    acquisition.setPolicy(null);
    const erased = metrics().erasures;
    assert.equal(erased, 2);
    assert.equal(savedValues.size, 0);
    await acquisition.page();
    await acquisition.page();
    await acquisition.retry();
    acquisition.destroy();
    assert.equal(metrics().erasures, erased);
    savedValues.set("logout:fonte-journey-v2", "existing");
    createCapture({ storage: "logout" }).reset();
    assert.equal(savedValues.has("logout:fonte-journey-v2"), false);
  }));

test("identical policy keeps dedup; changed policy clears context and pending observations", () =>
  host(
    async ({ make, requests }) => {
      const acquisition = make();
      const approved = policy();
      acquisition.setPolicy(approved);
      await acquisition.page();
      acquisition.setPolicy({ ...approved });
      await acquisition.page();
      assert.equal(requests.length, 2);
      acquisition.setPolicy(policy({ version: "changed-v2", clickIds: false }));
      await acquisition.retry();
      assert.equal(requests.length, 2);
      await acquisition.page({ navigation: true });
      assert.equal(requests.length, 4);
      assert.notEqual(requests[0].journeyId, requests[2].journeyId);
      assert.equal(requests[2].collectionVersion, "changed-v2");
      acquisition.destroy();
    },
    {
      reply() {
        throw Error("offline");
      },
    },
  ));

test("grant after denied arrival does not capture until caller supplies a new occurrence", () =>
  host(async ({ make, requests }) => {
    const acquisition = make();
    await acquisition.page();
    acquisition.setPolicy(policy());
    await acquisition.retry();
    assert.equal(requests.length, 0);
    await acquisition.page({ navigation: true });
    assert.equal(requests.length, 2);
    acquisition.destroy();
  }));

test("policy is snapshotted; caller mutation cannot silently broaden fields or prolong expiry", () =>
  host(
    async ({ make, requests, advance }) => {
      const input = policy({
        clickIds: false,
        adCookies: false,
        campaignValues: { utm_source: ["allowed"] },
        expiresAt: Date.now() + 100,
      });
      const acquisition = make();
      acquisition.setPolicy(input);
      input.clickIds = true;
      input.campaignValues.utm_source.push("planted");
      input.expiresAt += 60000;
      await acquisition.page();
      assert.equal(requests[0].scope.twclid, undefined);
      assert.equal(requests[0].scope.utm_source, undefined);
      advance(101);
      await acquisition.retry();
      await acquisition.page();
      assert.equal(requests.length, 2);
      acquisition.destroy();
    },
    {
      href: "https://website.example/?twclid=click&utm_source=planted",
      reply() {
        throw Error("offline");
      },
    },
  ));

test("port mutation cannot alter stable retry body, identity, occurrence or time", () =>
  host(
    async ({ make, requests }) => {
      const acquisition = make();
      acquisition.setPolicy(policy());
      await acquisition.page();
      window.location = "https://website.example/changed?twclid=new";
      await acquisition.retry();
      assert.deepEqual(requests.slice(0, 2), requests.slice(2, 4));
      acquisition.destroy();
    },
    {
      href: "https://website.example/?twclid=original",
      reply(body) {
        assert(Object.isFrozen(body));
        assert(Object.isFrozen(body.scope));
        assert.throws(() => (body.eventId = "mutated"), TypeError);
        assert.throws(() => (body.scope.twclid = "mutated"), TypeError);
        throw Error("lost acknowledgement");
      },
    },
  ));

for (const [name, reply, status, reason] of [
  ["accepted", (body) => accepted(body), "delivered", undefined],
  [
    "durable duplicate",
    (body) => accepted(body, { disposition: "duplicate_of_accepted" }),
    "delivered",
    undefined,
  ],
  ["missing", () => null, "failed", "receipt_unavailable"],
  ["array", () => [], "failed", "receipt_unavailable"],
  [
    "wrong event",
    (body) => accepted(body, { eventId: "unrelated" }),
    "failed",
    "receipt_unavailable",
  ],
  [
    "empty record",
    (body) => accepted(body, { recordId: "" }),
    "failed",
    "receipt_unavailable",
  ],
  [
    "oversize record",
    (body) => accepted(body, { recordId: "x".repeat(161) }),
    "failed",
    "receipt_unavailable",
  ],
  [
    "invalid date",
    (body) => accepted(body, { receivedAt: "invalid" }),
    "failed",
    "receipt_unavailable",
  ],
  [
    "unavailable",
    () => ({ disposition: "unavailable" }),
    "failed",
    "receipt_unavailable",
  ],
  ["ignored", () => ({ disposition: "ignored" }), "skipped", "ignored"],
  ["rejected", () => ({ disposition: "rejected" }), "failed", "rejected"],
])
  test(`shared durable receipt rules: ${name}`, () =>
    host(
      async ({ make }) => {
        const acquisition = make();
        acquisition.setPolicy(policy());
        const result = await acquisition.page();
        assert(
          result.deliveries.every(
            (delivery) =>
              delivery.status === status && delivery.reason === reason,
          ),
        );
        acquisition.destroy();
      },
      {
        reply(body) {
          return { httpStatus: 200, receipt: reply(body) };
        },
      },
    ));

for (const httpStatus of [408, 429, 503, 403])
  test(`HTTP${httpStatus} uses explicit bounded retry`, () =>
    host(
      async ({ make, requests }) => {
        const acquisition = make();
        acquisition.setPolicy(policy());
        await acquisition.page();
        assert.equal(requests.length, 2);
        await acquisition.retry();
        assert.equal(requests.length, httpStatus === 403 ? 2 : 4);
        await acquisition.retry();
        await acquisition.retry();
        assert.equal(requests.length, httpStatus === 403 ? 2 : 6);
        acquisition.destroy();
      },
      {
        reply() {
          return { httpStatus, receipt: null };
        },
      },
    ));

for (const httpStatus of ["200", 200.5, NaN])
  test(`malformed HTTP status cannot validate an otherwise matching receipt: ${String(httpStatus)}`, () =>
    host(
      async ({ make }) => {
        const acquisition = make();
        acquisition.setPolicy(policy());
        const result = await acquisition.page();
        assert(
          result.deliveries.every(
            (delivery) =>
              delivery.status === "failed" &&
              delivery.reason === "network_error",
          ),
        );
        acquisition.destroy();
      },
      {
        reply(body) {
          return { httpStatus, receipt: accepted(body) };
        },
      },
    ));

test("32 pending snapshots saturate, terminal snapshots free capacity, attempts and age are bounded", () =>
  host(
    async ({ make, requests, advance }) => {
      const acquisition = make();
      acquisition.setPolicy(policy());
      for (let i = 0; i < 17; i++) await acquisition.page({ navigation: true });
      assert.equal(requests.length, 32);
      await acquisition.retry();
      await acquisition.retry();
      assert.equal(requests.length, 96);
      const exhausted = await acquisition.retry();
      assert(
        exhausted.deliveries.every(
          (delivery) => delivery.reason === "retry_exhausted",
        ),
      );

      await acquisition.page({ navigation: true });
      assert.equal(requests.length, 98);
      advance(30 * 60_000 + 1);
      const expired = await acquisition.retry();
      assert(
        expired.deliveries.every((delivery) => delivery.reason === "expired"),
      );
      assert.equal(requests.length, 98);
      acquisition.destroy();
    },
    {
      reply() {
        throw Error("offline");
      },
    },
  ));

for (const change of ["withdraw", "changed", "destroy", "expired"])
  test(`in-flight ${change} aborts immediately and cannot accept late acknowledgement`, () => {
    const waiting = [];
    return host(
      async ({ make, requests }) => {
        const acquisition = make();
        acquisition.setPolicy(policy());
        const first = acquisition.page();
        assert.equal(waiting.length, 2);
        if (change === "withdraw") acquisition.setPolicy(null);
        if (change === "changed")
          acquisition.setPolicy(policy({ version: "changed-v2" }));
        if (change === "destroy") acquisition.destroy();
        if (change === "expired")
          acquisition.setPolicy(policy({ expiresAt: 1 }));
        assert(waiting.every(({ signal }) => signal.aborted));
        const result = await first;
        assert(
          result.deliveries.every(
            (delivery) => delivery.status !== "delivered",
          ),
        );
        for (const { body, resolve } of waiting)
          resolve({ httpStatus: 200, receipt: accepted(body) });
        await acquisition.retry();
        assert.equal(requests.length, 2);
        acquisition.destroy();
      },
      {
        reply(body, signal) {
          return new Promise((resolve) =>
            waiting.push({ body, signal, resolve }),
          );
        },
      },
    );
  });

test("hung transport ignoring abort settles at3s and performs no background retries", () =>
  host(async ({ make, requests }) => {
    const signals = [];
    const acquisition = make({
      transport(body, signal) {
        signals.push(signal);
        requests.push(body);
        return new Promise(() => {});
      },
    });
    acquisition.setPolicy(policy());
    const started = performance.now();
    const result = await acquisition.page();
    assert(performance.now() - started >= 2900);
    assert(performance.now() - started < 5500);
    assert(signals.every((signal) => signal.aborted));
    assert.equal(requests.length, 2);
    assert(
      result.deliveries.every(
        (delivery) => delivery.reason === "network_error",
      ),
    );

    acquisition.destroy();
  }));

test("withdrawal inside first transport prevents buffering or transmitting the next snapshot", () =>
  host(async ({ make, metrics }) => {
    let acquisition, finish;
    const outgoing = [];
    acquisition = make({
      transport(body, signal) {
        outgoing.push(body);
        acquisition.setPolicy(null);
        assert(signal.aborted);
        return new Promise(
          (resolve) =>
            (finish = () =>
              resolve({ httpStatus: 200, receipt: accepted(body) })),
        );
      },
    });
    acquisition.setPolicy(policy());
    const result = await acquisition.page();
    assert.equal(outgoing.length, 1);
    assert(
      result.deliveries.every((delivery) => delivery.status !== "delivered"),
    );
    const before = metrics();
    finish();
    assert.deepEqual((await acquisition.retry()).deliveries, []);
    assert.deepEqual(metrics(), before);
    acquisition.setPolicy(policy());
    assert.deepEqual((await acquisition.retry()).deliveries, []);
    assert.equal(outgoing.length, 1);
    acquisition.destroy();
  }));

for (const change of ["denied", "changed"])
  test(`synchronous abort-listener navigation observes ${change} policy and fresh context`, () =>
    host(async ({ make, metrics }) => {
      let acquisition,
        reentered = false,
        later;
      const bodies = [];
      acquisition = make({
        transport(body, signal) {
          bodies.push(body);
          if (body.collectionVersion === "next-v2")
            return Promise.resolve({
              httpStatus: 200,
              receipt: accepted(body),
            });
          signal.addEventListener("abort", () => {
            if (reentered) return;
            reentered = true;
            later = acquisition.page({ navigation: true });
          });
          return new Promise(() => {});
        },
      });
      acquisition.setPolicy(policy());
      const first = acquisition.page();
      const before = metrics();
      acquisition.setPolicy(
        change === "denied" ? null : policy({ version: "next-v2" }),
      );
      await first;
      const result = await later;
      if (change === "denied") {
        assert.equal(bodies.length, 2);
        assert.deepEqual(metrics(), before);
        assert(
          result.deliveries.every(
            (delivery) => delivery.reason === "collection_not_permitted",
          ),
        );
      } else {
        assert.equal(bodies.length, 4);
        assert(
          bodies.slice(2).every((body) => body.collectionVersion === "next-v2"),
        );
        assert.notEqual(bodies[0].journeyId, bodies[2].journeyId);
        assert(
          result.deliveries.every(
            (delivery) => delivery.status === "delivered",
          ),
        );
      }
      acquisition.destroy();
    }));

test("route denial reads no cookies/storage or identity and invalid legacy endpoints still reject", () =>
  host(async ({ make, metrics }) => {
    const acquisition = make();
    acquisition.setPolicy(policy({ routes: ["/allowed"] }));
    const result = await acquisition.page();
    assert(
      result.deliveries.every(
        (delivery) => delivery.reason === "route_not_permitted",
      ),
    );
    assert.equal(metrics().uuidCalls, 0);
    assert.equal(metrics().storageReads, 0);
    assert.equal(metrics().cookieReads, 0);
    for (const collect of [
      "https://collector.example/public",
      "//collector.example/path",
      "/\\collector",
    ])
      assert.throws(
        () => createCapture({ storage: "legacy", collect }),
        /same_origin_app_path/,
      );
    acquisition.destroy();
  }));
