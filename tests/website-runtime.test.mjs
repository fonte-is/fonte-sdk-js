import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import {
  parseSiteSettings,
  MAX_SETTINGS_BYTES,
} from "../packages/core/dist/website/settings.js";
import { WebsiteConfigurationError } from "../packages/core/dist/website/contract.js";
import { settings, siteId } from "./fixtures/website/settings.mjs";

test("default settings project and deeply freeze only known public fields", () => {
  const input = settings();
  input.future = { enabled: true, endpoint: "https://untrusted.example" };
  input.placements[0].form.future = "ignored";
  const value = parseSiteSettings(input, siteId);
  assert.equal(value.future, undefined);
  assert.equal(value.placements[0].form.future, undefined);
  assert(Object.isFrozen(value));
  assert(Object.isFrozen(value.collection.policy.routes));
  assert(Object.isFrozen(value.placements[0].form));
  input.placements[0].form.headline = "mutated";
  assert.equal(value.placements[0].form.headline, "Updates");
  assert.throws(() => value.collection.policy.routes.push("/new"), TypeError);
});

test("maximum declared settings and existing policy allowances validate", () => {
  const input = settings();
  input.origins = Array.from(
    { length: 32 },
    (_, i) => `https://site-${i}.example`,
  );
  input.collection.policy = {
    version: "policy-v1",
    expiresAt: Date.now() - 1,
    storage: "persistent",
    routes: Array(32).fill("/news/*"),
    clickIds: true,
    adCookies: true,
    sourceTokens: true,
    campaignValues: {
      utm_source: Array.from({ length: 64 }, (_, i) => `source${i}`),
    },
  };
  const form = {
    ...input.placements[0].form,
    headline: "é".repeat(256),
    submitLabel: "x".repeat(512),
    description: "é".repeat(4096),
    successMessage: "x".repeat(8192),
    scopeLabel: "x".repeat(512),
  };
  input.placements = Array.from({ length: 10 }, (_, i) => ({
    key: `p${i}`,
    presentation: ["inline", "popup", "slide_in"][i % 3],
    paths: Array(32).fill("/news/*"),
    form,
  }));
  const value = parseSiteSettings(input, siteId);
  assert.equal(value.placements.length, 10);
  assert.equal(value.origins.length, 32);
  assert.equal(
    value.collection.policy.expiresAt,
    input.collection.policy.expiresAt,
  );
});

test("aggregate settings cap rejects even when each known field fits its own bound", () => {
  const input = settings();
  const form = input.placements[0].form;
  Object.assign(form, {
    headline: "h".repeat(512),
    submitLabel: "b".repeat(512),
    scopeLabel: "s".repeat(512),
    description: "d".repeat(8192),
    successMessage: "m".repeat(8192),
  });
  input.placements = Array.from({ length: 10 }, (_, i) => ({
    ...input.placements[0],
    key: `p${i}`,
    paths: Array(32).fill("/" + "a".repeat(199)),
  }));
  input.collection.policy.campaignValues = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(
      (key) => [key, Array(64).fill("a".repeat(100))],
    ),
  );
  assert.throws(
    () => parseSiteSettings(input, siteId),
    (error) =>
      error instanceof WebsiteConfigurationError &&
      error.field === "settings.bytes",
  );
});

const invalid = [
  ["schema", (s) => (s.schema = "fonte.website.v2")],
  ["site", (s) => (s.siteId = "site_abcdef0123456789")],
  ["revision0", (s) => (s.revision = 0)],
  ["unsafe revision", (s) => (s.revision = Number.MAX_SAFE_INTEGER + 1)],
  ["enabled", (s) => (s.enabled = "true")],
  ["origin cap", (s) => (s.origins = Array(33).fill("https://host.example"))],
  ["placements cap", (s) => (s.placements = Array(11).fill(s.placements[0]))],
  [
    "duplicate placement",
    (s) => s.placements.push(structuredClone(s.placements[0])),
  ],
  ["path cap", (s) => (s.placements[0].paths = Array(33).fill("*"))],
  ["expression path", (s) => (s.placements[0].paths = ["/news?code=*"])],
  ["presentation", (s) => (s.placements[0].presentation = "script")],
  [
    "form uuid",
    (s) =>
      (s.placements[0].form.publicId = "00000000-0000-0000-0000-000000000000"),
  ],
  ["form revision", (s) => (s.placements[0].form.publishedRevision = -1)],
  ["copy bytes", (s) => (s.placements[0].form.headline = "é".repeat(257))],
  [
    "description bytes",
    (s) => (s.placements[0].form.description = "é".repeat(4097)),
  ],
  [
    "success bytes",
    (s) => (s.placements[0].form.successMessage = "x".repeat(8193)),
  ],
  ["button bytes", (s) => (s.placements[0].form.submitLabel = "x".repeat(513))],
  ["scope bytes", (s) => (s.placements[0].form.scopeLabel = "x".repeat(513))],
  [
    "form aggregate bytes",
    (s) => {
      s.placements[0].form.description = "\n".repeat(8192);
      s.placements[0].form.successMessage = "\n".repeat(8192);
    },
  ],
  ["control copy", (s) => (s.placements[0].form.headline = "bad\u0000")],
  ["surrogate copy", (s) => (s.placements[0].form.headline = "\ud800")],
  ["confirmation", (s) => (s.placements[0].form.confirmation = "instant")],
  ["firstNameEnabled", (s) => (s.placements[0].form.firstNameEnabled = 1)],
  ["mode", (s) => (s.collection.mode = "future")],
  ["policy status", (s) => (s.collection.policy.status = "granted")],
  ["policy version", (s) => (s.collection.policy.version = "unsafe version")],
  ["policy expiry", (s) => (s.collection.policy.expiresAt = Infinity)],
  ["policy storage", (s) => (s.collection.policy.storage = "indexeddb")],
  [
    "policy routes",
    (s) => (s.collection.policy.routes = ["http://collector.example"]),
  ],
  ["policy flag", (s) => (s.collection.policy.clickIds = "true")],
  [
    "policy campaign",
    (s) => (s.collection.policy.campaignValues = { unknown: ["x"] }),
  ],
  [
    "campaign value",
    (s) =>
      (s.collection.policy.campaignValues = { utm_source: ["unsafe space"] }),
  ],
];
for (const [name, mutate] of invalid)
  test(`atomic rejection: ${name}`, () => {
    const input = settings();
    mutate(input);
    assert.throws(
      () => parseSiteSettings(input, siteId),
      WebsiteConfigurationError,
    );
  });
for (const origin of [
  "https://*.example",
  "https://host.example/path",
  "https://host.example/foo/..",
  "https://host.example/?",
  "https://host.example/#",
  "https://user:pass@host.example",
  "https://@host.example",
  "https://host.example\t",
  " https://host.example",
  "https://host.example\\",
  "http://host.example",
  "http://localhost.example",
  "http://127.1",
  "http://2130706433",
  "http://0x7f000001",
  "http://[0:0:0:0:0:0:0:1]",
  "javascript:alert(1)",
])
  test(`unsafe origin rejected: ${JSON.stringify(origin)}`, () => {
    assert.throws(
      () => parseSiteSettings(settings(origin), siteId),
      WebsiteConfigurationError,
    );
  });
test("origin normalization and exact local fixture hosts", () => {
  for (const [input, output] of [
    ["https://EXAMPLE.com:443/", "https://example.com"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
    ["http://[::1]:3000", "http://[::1]:3000"],
  ])
    assert.deepEqual(parseSiteSettings(settings(input), siteId).origins, [
      output,
    ]);
});

let browser, server, origin;
let httpRequests = [];
let httpMode = "valid";
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://fixture").pathname;
      if (pathname === "/settings") {
        httpRequests.push(req.headers);
        if (httpMode === "stall") {
          res.writeHead(200, { "content-type": "application/json" });
          res.write("{");
          return;
        }
        if (httpMode === "oversize") {
          res.writeHead(200, { "content-type": "application/json" });
          for (let i = 0; i < 65; i++) res.write(" ".repeat(4096));
          res.end();
          return;
        }
        if (httpMode === "304") {
          res.writeHead(304);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          etag: '"real-v1"',
        });
        res.end(JSON.stringify(settings(origin)));
        return;
      }
      const relative = pathname.startsWith("/dist/")
        ? `../packages/core/dist/${pathname.slice(6)}`
        : pathname.startsWith("/fixtures/")
          ? `fixtures/website/${pathname.slice(10)}`
          : "fixtures/website/page.html";
      if (relative.includes("..", 3)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": relative.endsWith(".html")
          ? "text/html"
          : "text/javascript",
      });
      res.end(await readFile(new URL(relative, import.meta.url)));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: "chrome" }),
  });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});
async function pageFixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(`${origin}/host`);
  await page.waitForFunction(() => Boolean(window.foundation));
  return page;
}
const ready = (page) =>
  page.waitForFunction(() => window.runtime.getStatus().state === "ready");
const unavailable = (page) =>
  page.waitForFunction(
    () => window.runtime.getStatus().state === "unavailable",
  );

test("browser: initial callback order, duplicates/conflict, exact status, zero storage and idle I/O", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    const original = window.start();
    window.same = window.start({
      onSettings() {
        throw Error("duplicate callback");
      },
    });
    window.conflict = window.start({ siteId: window.foundation.otherSiteId });
    window.runtime = original;
  });
  await ready(page);
  const value = await page.evaluate(() => ({
    ...window.snapshot(),
    same: window.same === window.runtime,
    conflict: window.conflict.getStatus(),
  }));
  assert.deepEqual(
    value.log.map((v) => v[0]),
    ["policy", "settings", "navigation"],
  );
  assert.equal(value.log[2][2], false);
  assert.equal(value.requests.length, 1);
  assert.equal(value.conflict.state, "conflict");
  assert.equal(value.storageCalls, 0);
  assert.deepEqual(value.status.forms, { mounted: 2, unavailable: 1 });
  assert(value.same);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
});

test("browser: no feature/storage effects before settings; synchronous denial protects automatic startup", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    window.replies.push(
      () => new Promise((resolve) => (window.resolveSettings = resolve)),
    );
    window.start();
    window.runtime.setConsent("denied");
  });
  assert.deepEqual(await page.evaluate(() => window.log), []);
  assert.equal(await page.evaluate(() => window.storageCalls), 0);
  await page.evaluate(() =>
    window.resolveSettings(
      new Response(JSON.stringify(window.foundation.settings(location.origin))),
    ),
  );
  await ready(page);
  assert.deepEqual(await page.evaluate(() => window.log.map((v) => v[0])), [
    "policy",
    "settings",
    "navigation",
  ]);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "denied",
  );
  assert.equal(await page.evaluate(() => window.log[0][1]), null);
});

test("browser: settings mismatch/origin/schema reject before effects and HTTP304 cannot bootstrap", async (t) => {
  for (const kind of ["origin", "site", "schema", "304"]) {
    const page = await pageFixture(t);
    await page.evaluate((kind) => {
      const value = window.foundation.settings(location.origin);
      if (kind === "origin") value.origins = ["https://foreign.example"];
      if (kind === "site") value.siteId = window.foundation.otherSiteId;
      if (kind === "schema") value.schema = "unknown";
      window.replies.push(kind === "304" ? "304" : value);
      window.start();
    }, kind);
    await unavailable(page);
    const value = await page.evaluate(() => window.snapshot());
    assert.deepEqual(value.log, [
      ["policy", null],
      ["settings", null],
    ]);
    assert.equal(value.storageCalls, 0);
    assert.equal(value.status.settingsRevision, null);
    await page.close();
  }
});

test("browser: failure retains validated display/navigation, clears policy,304 restores without replay", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => window.start());
  await ready(page);
  await page.evaluate(async () => {
    window.replies.push("outage");
    await window.runtime.refresh();
    history.pushState({}, "", "/during-outage");
  });
  let value = await page.evaluate(() => window.snapshot());
  assert.equal(value.status.state, "unavailable");
  assert.equal(value.status.settingsRevision, 1);
  assert.equal(value.status.collection, "unavailable");
  assert.deepEqual(
    value.log.filter((v) => v[0] === "settings"),
    [["settings", 1]],
  );
  assert.equal(value.log.filter((v) => v[0] === "navigation").length, 2);
  await page.evaluate(async () => {
    window.replies.push("304");
    await window.runtime.refresh();
  });
  value = await page.evaluate(() => window.snapshot());
  assert.equal(value.status.state, "ready");
  assert.equal(value.requests.at(-1).headers["If-None-Match"], '"rev-1"');
  assert.equal(value.log.filter((v) => v[0] === "navigation").length, 2);
});

test("browser: fresh200 without validator clears old ETag, disabled generation removes display", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => window.start());
  await ready(page);
  await page.evaluate(async () => {
    window.replies.push(
      () =>
        new Response(
          JSON.stringify(
            window.foundation.settings(location.origin, { revision: 2 }),
          ),
        ),
    );
    await window.runtime.refresh();
    window.replies.push(
      window.foundation.settings(location.origin, {
        revision: 3,
        enabled: false,
      }),
    );
    await window.runtime.refresh();
  });
  const value = await page.evaluate(() => window.snapshot());
  assert.deepEqual(value.requests[2].headers, {});
  assert.equal(value.status.state, "disabled");
  assert.equal(value.status.collection, "off");
  assert.deepEqual(value.log.slice(-2), [
    ["policy", null],
    ["settings", null],
  ]);
  assert.equal(value.log.filter((v) => v[0] === "navigation").length, 1);
});

test("browser: denied/unknown consent never replays arrivals; genuine navigation remains usable", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    const value = window.foundation.settings(location.origin);
    value.collection.mode = "opt_in";
    window.replies.push(value);
    window.start();
  });
  await ready(page);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "unknown",
  );
  await page.evaluate(() => {
    window.runtime.setConsent("granted");
    window.runtime.setConsent("denied");
    window.runtime.setConsent("unknown");
  });
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "denied",
  );
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    1,
  );
  await page.evaluate(() => {
    history.pushState({}, "", "/denied");
    window.runtime.setConsent("granted");
    history.pushState({}, "", "/allowed");
  });
  const value = await page.evaluate(() => window.snapshot());
  assert.equal(value.status.collection, "enabled");
  assert.equal(value.log.filter((v) => v[0] === "navigation").length, 3);
  assert.equal(value.requests.length, 1);
});

test("browser: expiry cuts collection without navigation; far expiry does not overflow browser timer", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    const value = window.foundation.settings(location.origin);
    value.collection.policy.expiresAt = Date.now() + 300;
    window.replies.push(value);
    window.start();
  });
  await ready(page);
  await page.waitForFunction(
    () => window.runtime.getStatus().collection === "unavailable",
  );
  assert.deepEqual(await page.evaluate(() => window.log.at(-1)), [
    "policy",
    null,
  ]);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().state),
    "ready",
  );
  await page.evaluate(async () => {
    const value = window.foundation.settings(location.origin, { revision: 2 });
    value.collection.policy.expiresAt = Date.now() + 2_147_483_648 + 1000;
    window.replies.push(value);
    await window.runtime.refresh();
  });
  await page.waitForTimeout(40);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "enabled",
  );
  assert.equal(await page.evaluate(() => window.requests.length), 2);
});

test("browser: expired valid policy and off/no-policy retain display, without collection", async (t) => {
  for (const kind of ["expired", "off", "no-policy"]) {
    const page = await pageFixture(t);
    await page.evaluate((kind) => {
      const value = window.foundation.settings(location.origin);
      if (kind === "expired") value.collection.policy.expiresAt = 1;
      if (kind === "off") value.collection.mode = "off";
      if (kind === "no-policy") value.collection.policy = null;
      window.replies.push(value);
      window.start();
    }, kind);
    await ready(page);
    const value = await page.evaluate(() => window.snapshot());
    assert.deepEqual(
      value.log.map((v) => v[0]),
      ["policy", "settings", "navigation"],
    );
    assert.equal(value.log[0][1], null);
    assert.equal(
      value.status.collection,
      kind === "off" ? "off" : "unavailable",
    );
    await page.close();
  }
});

test("browser: callback exceptions/count failures isolated and settings immutable", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() =>
    window.start({
      onCollectionPolicy() {
        throw Error("observer");
      },
      onSettings(value) {
        window.log.push(["settings", value.revision]);
        value.enabled = false;
      },
      onNavigation(occurrence) {
        window.log.push(["navigation", occurrence.navigation]);
        throw Error("observer");
      },
      getFormCounts() {
        throw Error("count");
      },
    }),
  );
  await ready(page);
  const value = await page.evaluate(() => window.snapshot());
  assert.equal(value.status.collection, "enabled");
  assert.deepEqual(value.status.forms, { mounted: 0, unavailable: 0 });
  assert.deepEqual(value.log, [
    ["settings", 1],
    ["navigation", false],
  ]);
});

test("browser: callback-triggered navigation preserves policy/settings/navigation order", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() =>
    window.start({
      onCollectionPolicy(policy) {
        window.log.push(["policy", Boolean(policy)]);
        if (policy) history.pushState({}, "", "/from-policy");
      },
    }),
  );
  await ready(page);
  const log = await page.evaluate(() => window.log);
  assert.deepEqual(
    log.map((v) => v[0]),
    ["policy", "settings", "navigation"],
  );
  assert.equal(log[2][1], `${origin}/from-policy`);
  assert.equal(log[2][2], true);
});

test("browser: destroying from policy callback blocks later generation effects", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() =>
    window.start({
      onCollectionPolicy(policy) {
        window.log.push(["policy", Boolean(policy)]);
        if (policy) window.runtime.destroy();
      },
    }),
  );
  await unavailable(page);
  assert.deepEqual(await page.evaluate(() => window.log), [
    ["policy", true],
    ["policy", false],
    ["settings", null],
  ]);
  assert.equal(
    await page.evaluate(() => Symbol.for("fonte.website.v1") in window),
    false,
  );
});

test("browser: callbacks can withdraw or destroy during generation without stale effects", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() =>
    window.start({
      onCollectionPolicy(policy) {
        window.log.push(["policy", Boolean(policy)]);
        if (policy) window.runtime.setConsent("denied");
      },
    }),
  );
  await ready(page);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "denied",
  );
  await page.evaluate(() => {
    window.runtime.destroy();
    window.log = [];
    window.start({
      onSettings(value) {
        window.log.push(["settings", value?.revision ?? null]);
        if (value) window.runtime.destroy();
      },
    });
  });
  await unavailable(page);
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(() => Symbol.for("fonte.website.v1") in window),
    false,
  );
  assert.deepEqual(
    parseSiteSettings(settings("HTTPS://EXAMPLE.com:443/"), siteId).origins,
    ["https://example.com"],
  );
});

test("browser: real URL changes and same-URL later traversal; pop/hash dedup, pageshow, focus", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => window.start());
  await ready(page);
  await page.evaluate(() => {
    history.pushState({ id: 1 }, "", location.href);
    history.replaceState({ id: 2 }, "", location.href);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
  });
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    1,
  );
  await page.evaluate(() => {
    history.pushState({}, "", "/next#hash");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    history.replaceState({}, "", "/replacement");
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  const value = await page.evaluate(() => window.snapshot());
  assert.equal(value.log.filter((v) => v[0] === "navigation").length, 5);
  assert(
    value.log
      .filter((v) => v[0] === "navigation")
      .slice(1)
      .every((v) => v[2]),
  );
  assert.equal(value.requests.length, 1);
  // Real browser traversal to another history entry at the same href is an arrival.
  await page.evaluate(() =>
    history.pushState({ same: true }, "", location.href),
  );
  const count = await page.evaluate(
    () => window.log.filter((v) => v[0] === "navigation").length,
  );
  await page.evaluate(() => history.back());
  await page.waitForFunction(
    (count) => window.log.filter((v) => v[0] === "navigation").length > count,
    count,
  );
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    count + 1,
  );
});

test("browser: age-gated event refreshes and explicit refreshes coalesce, never replay", async (t) => {
  const page = await pageFixture(t);
  await page.clock.install();
  await page.evaluate(() => window.start());
  await ready(page);
  await page.clock.fastForward(60_001);
  await page.evaluate(() => {
    window.replies.push(
      () => new Promise((resolve) => (window.resolveRefresh = resolve)),
    );
    history.pushState({}, "", "/one");
    history.replaceState({}, "", "/two");
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    window.refresh1 = window.runtime.refresh();
    window.refresh2 = window.runtime.refresh();
    window.sameRefresh = window.refresh1 === window.refresh2;
  });
  assert.equal(await page.evaluate(() => window.requests.length), 2);
  assert.equal(await page.evaluate(() => window.sameRefresh), true);
  await page.evaluate(async () => {
    window.resolveRefresh(new Response(null, { status: 304 }));
    await window.refresh1;
  });
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    3,
  );
  await page.clock.fastForward(600_000);
  assert.equal(await page.evaluate(() => window.requests.length), 2);
});

test("browser: real HTTP omits credentials/referrer, validates304, bounds streamed body and3s body timeout", async (t) => {
  const page = await pageFixture(t);
  httpMode = "valid";
  httpRequests = [];
  await page
    .context()
    .addCookies([{ name: "host_session", value: "private", url: origin }]);
  await page.evaluate(() =>
    window.start({ fetchImpl: window.fetch.bind(window) }),
  );
  await ready(page);
  assert.equal(httpRequests[0].cookie, undefined);
  assert.equal(httpRequests[0].referer, undefined);
  httpMode = "304";
  await page.evaluate(() => window.runtime.refresh());
  assert.equal(httpRequests[1]["if-none-match"], '"real-v1"');
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    1,
  );
  httpMode = "oversize";
  await page.evaluate(() => window.runtime.refresh());
  await unavailable(page);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().collection),
    "unavailable",
  );
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "settings").length,
    ),
    2,
  );
  httpMode = "stall";
  const started = Date.now();
  await page.evaluate(() => window.runtime.refresh());
  assert(Date.now() - started >= 2800);
  assert(Date.now() - started < 6000);
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().state),
    "unavailable",
  );
  httpMode = "valid";
});

test("browser: decoded bytes ignore spoofed Content-Length; oversize aborts and cancels stream", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    window.replies.push((url, options) => {
      window.abortSeen = false;
      options.signal.addEventListener("abort", () => (window.abortSeen = true));
      let count = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("é".repeat(2048)));
            count++;
            if (count > 70) controller.close();
          },
          cancel() {
            window.streamCanceled = true;
          },
        }),
        { headers: { "content-length": "2" } },
      );
    });
    window.start();
  });
  await unavailable(page);
  assert.deepEqual(
    await page.evaluate(() => [
      window.abortSeen,
      window.streamCanceled,
      window.storageCalls,
    ]),
    [true, true, 0],
  );
  assert.deepEqual(await page.evaluate(() => window.log), [
    ["policy", null],
    ["settings", null],
  ]);
  assert.equal(MAX_SETTINGS_BYTES, 262144);
});

test("browser: timeout contains fetch ignoring abort; destroyed in-flight read cannot activate", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    window.replies.push(() => new Promise(() => {}));
    window.start();
  });
  await unavailable(page);
  assert.deepEqual(await page.evaluate(() => window.log), [
    ["policy", null],
    ["settings", null],
  ]);
  await page.evaluate(() => {
    window.runtime.destroy();
    window.log = [];
    window.replies.push(
      () => new Promise((resolve) => (window.resolveDestroyed = resolve)),
    );
    window.start();
  });
  await page.waitForFunction(() => Boolean(window.resolveDestroyed));
  await page.evaluate(() => {
    window.stale = window.runtime;
    window.runtime.destroy();
    window.start();
    window.resolveDestroyed(
      new Response(
        new ReadableStream({
          start() {},
          cancel() {
            window.lateBodyCanceled = true;
          },
        }),
      ),
    );
  });
  await ready(page);
  await page.waitForFunction(() => window.lateBodyCanceled);
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    1,
  );
  await page.evaluate(() => window.stale.destroy());
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().state),
    "ready",
  );
});

test("browser: history arguments/results/this and later host wrapper survive destroy/reinit", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    const native = history.pushState;
    window.hostCalls = [];
    window.originalHost = history.pushState = function (...args) {
      window.hostCalls.push({ sameThis: this === history, args });
      native.apply(this, args);
      return "host-result";
    };
    window.start();
  });
  await ready(page);
  assert.equal(
    await page.evaluate(() =>
      history.pushState({ test: 1 }, "title", "/first"),
    ),
    "host-result",
  );
  await page.evaluate(() => {
    const fonte = history.pushState;
    window.laterHost = history.pushState = function (...args) {
      return fonte.apply(this, args);
    };
    window.stale = window.runtime;
    window.runtime.destroy();
    window.runtime.destroy();
  });
  assert.equal(
    await page.evaluate(() => history.pushState === window.laterHost),
    true,
  );
  const count = await page.evaluate(() => window.log.length);
  await page.evaluate(() => {
    history.pushState({ test: 2 }, "title", "/after-destroy");
    window.dispatchEvent(new Event("focus"));
  });
  assert.equal(await page.evaluate(() => window.log.length), count);
  await page.evaluate(() => {
    window.start();
    window.stale.destroy();
  });
  await ready(page);
  await page.evaluate(() => history.pushState({}, "", "/new-runtime"));
  assert.equal(
    await page.evaluate(
      () => window.log.filter((v) => v[0] === "navigation").length,
    ),
    4,
  );
  assert(await page.evaluate(() => window.hostCalls.every((v) => v.sameThis)));
  assert.deepEqual(await page.evaluate(() => window.hostCalls[0].args), [
    { test: 1 },
    "title",
    "/first",
  ]);
  await page.evaluate(() => window.runtime.destroy());
  assert.equal(
    await page.evaluate(() => history.pushState === window.laterHost),
    true,
  );
});

test("browser: invalid local options are contained and unrelated globals preserved", async (t) => {
  const page = await pageFixture(t);
  await page.evaluate(() => {
    window.fonte = { host: true };
    window.start({ settingsUrl: "javascript:alert(1)" });
  });
  assert.equal(
    await page.evaluate(() => window.runtime.getStatus().state),
    "unavailable",
  );
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  assert.deepEqual(await page.evaluate(() => window.fonte), { host: true });
});
