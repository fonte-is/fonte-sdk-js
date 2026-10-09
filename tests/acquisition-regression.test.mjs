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
  sourceFields: {
    query: ["campaign_click", "alternate_click"],
    cookies: ["visit_cookie", "session_cookie"],
  },
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
      window.location = new URL("https://example.test/?campaign_click=changed");
      document.cookie = "visit_cookie=changed";
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
      "https://example.test/?utm_source=fake-secret@example.test&campaign_click=ok-click&access_token=planted-secret",
    );
    document.referrer =
      "https://referrer.example/private/path?token=planted-secret";
    await createCapture({
      storage: "redaction",
      collectionPolicy: policy,
    }).page();
    const serialized = JSON.stringify(requests);
    assert.ok(!serialized.includes("planted-secret"));
    assert.ok(!serialized.includes("fake-secret"));
    assert.ok(!serialized.includes("/private/path"));
    assert.deepEqual(requests[0].sourceEvidence.query, [
      { name: "campaign_click", value: "ok-click" },
    ]);
    assert.equal(requests[0].scope.referrer, "https://referrer.example");
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
test("source link identity and observed referrer remain separate facts", () =>
  browser(async (requests) => {
    window.location = new URL("https://example.test/?fonte=opaque-issued-link");
    document.referrer = "https://elsewhere.example.test/private";
    await createCapture({
      storage: "link-evidence",
      collectionPolicy: () => ({ ...policy(), sourceTokens: true }),
    }).page();
    assert.equal(requests[0].scope.fonte, "opaque-issued-link");
    assert.equal(requests[0].scope.referrer, "https://elsewhere.example.test");
  }));

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

test("installation can select all routes and campaigns without an automatic expiry", () => {
  const rich = {
    status: "granted",
    version: "synthetic-rich-v1",
    expiresAt: null,
    storage: "persistent",
    routes: ["*"],
    campaignValues: true,
    clickIds: true,
    sourceFields: { query: ["campaign_click"], cookies: [] },
    sourceTokens: true,
  };
  assert.equal(collect.permitted(rich), true);
  const scope = collect.minimizeScope(
    {
      current_url: "https://example.test/workspace/home?secret=excluded",
      utm_campaign: "new-campaign",
      campaign_click: "new-click",
    },
    rich,
  );
  assert.equal(scope.utm_campaign, "new-campaign");
  assert.deepEqual(
    collect.minimizeSourceEvidence(
      { query: [{ name: "campaign_click", value: "new-click" }], cookies: [] },
      rich,
    ).query,
    [{ name: "campaign_click", value: "new-click" }],
  );
  assert.equal(scope.current_url, "https://example.test/workspace/home");
  assert.equal(
    collect.minimizeScope(
      { current_url: "https://example.test/docs/start" },
      { ...rich, routes: ["/docs/*"] },
    ).canonical_route,
    "/docs/start",
  );
  assert.equal(
    collect.minimizeScope(
      { current_url: "https://example.test/not-docs/start" },
      { ...rich, routes: ["/docs/*"] },
    ),
    null,
  );
  assert.equal(collect.permitted({ ...rich, status: "denied" }), false);
});

test("campaign facts fit 500 UTF-8 bytes or remain absent without truncating other evidence", () =>
  browser(async (requests) => {
    const url = new URL("https://example.test/");
    url.searchParams.set("utm_source", "x".repeat(501));
    url.searchParams.set("utm_medium", "é".repeat(251));
    url.searchParams.set("utm_campaign", "é".repeat(250));
    url.searchParams.set("utm_content", "x".repeat(500));
    url.searchParams.set("utm_term", "campaign\u0000changed");
    url.searchParams.set("fonte", "issued-link");
    url.searchParams.set("campaign_click", "retained-click");
    window.location = url;
    const observed = [];
    await createCapture({
      storage: "campaign-bounds",
      collectionPolicy: () => ({
        ...policy(),
        campaignValues: true,
        sourceTokens: true,
      }),
      onObservation: (body) => observed.push(body),
    }).page();
    assert.equal(requests.length, 2);
    assert.deepEqual(observed, requests);
    for (const body of requests) {
      assert.equal(body.scope.utm_source, undefined);
      assert.equal(body.scope.utm_medium, undefined);
      assert.equal(body.scope.utm_term, undefined);
      assert.equal(body.scope.utm_campaign, "é".repeat(250));
      assert.equal(body.scope.utm_content, "x".repeat(500));
      assert.equal(body.scope.fonte, "issued-link");
      assert.deepEqual(body.sourceEvidence.query, [
        { name: "campaign_click", value: "retained-click" },
      ]);
      assert(Buffer.byteLength(JSON.stringify(body)) <= 16384);
    }
    const reparsed = await collect.parse(
      new Request("https://example.test/", {
        method: "POST",
        body: JSON.stringify({
          ...requests[0],
          scope: {
            ...requests[0].scope,
            utm_source: "x".repeat(501),
            utm_medium: "é".repeat(251),
            utm_term: "campaign\u0000changed",
          },
        }),
      }),
    );
    assert.deepEqual(reparsed, requests[0]);
  }));

test("collector never shortens a route or source token into a different accepted fact", () =>
  browser(async (requests) => {
    window.location = new URL(`https://example.test/${"p".repeat(2000)}`);
    await createCapture({
      storage: "parser-field-bounds",
      collectionPolicy: () => ({ ...policy(), routes: ["*"] }),
    }).page();
    const body = requests[0];
    const parse = (scope) =>
      collect.parse(
        new Request("https://example.test/", {
          method: "POST",
          body: JSON.stringify({ ...body, scope }),
        }),
      );
    assert.equal(
      (await parse(body.scope)).scope.canonical_route,
      `/${"p".repeat(2000)}`,
    );
    assert.equal(
      await parse({
        ...body.scope,
        current_url: `https://example.test/${"p".repeat(2048)}`,
      }),
      null,
    );
    const admitted = await parse({
      ...body.scope,
      fonte: `${"f".repeat(500)}suffix`,
      referrer: `https://${"r".repeat(2048)}.test/`,
    });
    assert.equal(admitted.scope.fonte, undefined);
    assert.equal(admitted.scope.referrer, undefined);
    assert.equal(admitted.scope.current_url, body.scope.current_url);
    assert.equal(admitted.journeyId, body.journeyId);
  }));

test("an oversized route is neither observed nor queued and a later valid visit still works", () =>
  browser(async (requests) => {
    window.location = new URL(`https://example.test/${"x".repeat(20000)}`);
    const observed = [];
    const capture = createCapture({
      storage: "route-bounds",
      collectionPolicy: () => ({ ...policy(), routes: ["*"] }),
      onObservation: (body) => observed.push(body),
    });
    const result = await capture.page();
    assert(result.deliveries.every((item) => item.status === "skipped"));
    assert.equal(requests.length, 0);
    assert.equal(observed.length, 0);
    assert.deepEqual((await capture.retry()).deliveries, []);
    window.location = new URL("https://example.test/");
    await capture.page();
    assert.equal(requests.length, 2);
  }));

test("complete envelopes over the collector limit never reach hooks, transport or retry", () =>
  browser(async (requests) => {
    const query = Array.from(
      { length: 8 },
      (_, i) => `query_${i}_${"q".repeat(56)}`,
    );
    const cookies = Array.from(
      { length: 2 },
      (_, i) => `cookie_${i}_${"c".repeat(55)}`,
    );
    const url = new URL(`https://example.test/${"p".repeat(2000)}`);
    for (const name of query) url.searchParams.set(name, "x".repeat(500));
    for (const name of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ])
      url.searchParams.set(name, '"'.repeat(500));
    url.searchParams.set("fonte", "f".repeat(500));
    window.location = url;
    document.referrer = `https://${"r".repeat(2000)}.test/`;
    document.cookie = cookies
      .map((name) => `${name}=${"c".repeat(500)}`)
      .join("; ");
    const observed = [];
    const capture = createCapture({
      storage: "envelope-bounds",
      collectionPolicy: () => ({
        ...policy(),
        routes: ["*"],
        campaignValues: true,
        sourceTokens: true,
        sourceFields: { query, cookies },
      }),
      onObservation: (body) => observed.push(body),
    });
    const result = await capture.page();
    assert.equal(result.deliveries.length, 2);
    assert(
      result.deliveries.every(
        (item) => item.status === "failed" && item.reason === "rejected",
      ),
    );
    assert.equal(requests.length, 0);
    assert.equal(observed.length, 0);
    assert.deepEqual((await capture.retry()).deliveries, []);
    window.location = new URL("https://example.test/");
    document.referrer = "";
    document.cookie = "";
    await capture.page({ navigation: true });
    assert.equal(requests.length, 2);
    assert.equal(observed.length, 2);
  }));
