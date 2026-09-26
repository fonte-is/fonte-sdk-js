import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { build } from "esbuild";
import { createWebsiteHttp } from "../packages/core/dist/website/http.js";
import { websiteEndpoints } from "../packages/core/dist/website/endpoints.js";
import { settings, siteId, otherSiteId } from "./fixtures/website/settings.mjs";

// These are client protocol fixtures, never native/Core acceptance evidence.
const publicId = "12345678-1234-4234-8234-123456789abc";
const submissionId = "00000000-0000-4000-8000-000000000001";
const intent = () =>
  Object.freeze({
    requestId: crypto.randomUUID(),
    publicId,
    publishedRevision: 1,
    values: Object.freeze({
      email: "synthetic@example.test",
      firstName: "Fixture",
    }),
  });
test("fixed routes reject path/endpoint injection", () => {
  assert.equal(
    websiteEndpoints(siteId).settings,
    `https://cdn.fonte.is/v1/websites/${siteId}/settings`,
  );
  assert.equal(
    websiteEndpoints(siteId).submission(publicId),
    `https://api.fonte.is/v1/websites/${siteId}/forms/${publicId}/submissions`,
  );
  for (const value of [
    "../private",
    `${siteId}?token=x`,
    "https://evil.example",
  ])
    assert.throws(() => websiteEndpoints(value));
  assert.throws(() => websiteEndpoints(siteId).submission("../private"));
});
for (const [status, body, expected] of [
  [201, { kind: "received", submissionId }, { kind: "received", submissionId }],
  [200, { kind: "received", submissionId }, { kind: "received", submissionId }],
  [200, {}, { kind: "unavailable", retryable: true }],
  [
    200,
    { kind: "completed", submissionId },
    { kind: "unavailable", retryable: true },
  ],
  [
    201,
    { kind: "received", submissionId: "not-a-uuid" },
    { kind: "unavailable", retryable: true },
  ],
  [409, { error: "form_revision_stale" }, { kind: "revision_changed" }],
  [
    409,
    { error: "form_submission_idempotency_conflict" },
    { kind: "invalid", field: null },
  ],
  [
    400,
    { error: "form_submission_invalid", field: "email" },
    { kind: "invalid", field: "email" },
  ],
  [400, { field: "firstName" }, { kind: "invalid", field: "firstName" }],
  [
    404,
    { error: "form_unavailable" },
    { kind: "unavailable", retryable: false },
  ],
  [
    409,
    { error: "form_scope_unavailable" },
    { kind: "unavailable", retryable: false },
  ],
  [429, {}, { kind: "unavailable", retryable: true }],
  [503, {}, { kind: "unavailable", retryable: true }],
])
  test(`native HTTP ${status}/${JSON.stringify(body)} maps conservatively`, async () => {
    const calls = [];
    const http = createWebsiteHttp({
      siteId,
      fetchImpl: async (...args) => {
        calls.push(args);
        return new Response(JSON.stringify(body), { status });
      },
    });
    const frozen = intent();
    assert.deepEqual(await http.submit(frozen), expected);
    const [url, init] = calls[0];
    assert.equal(
      url,
      `https://api.fonte.is/v1/websites/${siteId}/forms/${publicId}/submissions`,
    );
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.deepEqual(init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), {
      requestId: frozen.requestId,
      publishedRevision: 1,
      values: frozen.values,
    });
    http.destroy();
  });
test("ambiguous retry preserves original bytes and expires after24h without remint", async () => {
  const bodies = [];
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  const http = createWebsiteHttp({
    siteId,
    fetchImpl: async (_url, init) => {
      bodies.push(init.body);
      if (bodies.length === 1) throw Error("lost_ack");
      return Response.json({ kind: "received", submissionId });
    },
  });
  try {
    const frozen = intent();
    assert.deepEqual(await http.submit(frozen), {
      kind: "unavailable",
      retryable: true,
    });
    assert.deepEqual(await http.submit(frozen), {
      kind: "received",
      submissionId,
    });
    assert.equal(bodies[0], bodies[1]);
    now += 24 * 60 * 60 * 1_000;
    assert.deepEqual(await http.submit(frozen), {
      kind: "unavailable",
      retryable: false,
    });
    assert.equal(bodies.length, 2);
  } finally {
    Date.now = originalNow;
    http.destroy();
  }
});
test("hung HTTP settles at3s; destroy fences late acknowledgement", async () => {
  let resolve, signal;
  const http = createWebsiteHttp({
    siteId,
    fetchImpl: (_url, init) => {
      signal = init.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  assert.deepEqual(await http.submit(intent()), {
    kind: "unavailable",
    retryable: true,
  });
  assert(signal.aborted);
  const next = http.submit(intent());
  await Promise.resolve();
  http.destroy();
  resolve(Response.json({ kind: "received", submissionId }));
  assert.deepEqual(await next, { kind: "unavailable", retryable: true });
});
test("oversized/invalid acknowledgements never become success; aborted observations stop", async () => {
  let calls = 0;
  const http = createWebsiteHttp({
    siteId,
    fetchImpl: async () => {
      calls++;
      return new Response("x".repeat(16_385));
    },
  });
  assert.deepEqual(await http.submit(intent()), {
    kind: "unavailable",
    retryable: true,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(http.transport({}, controller.signal));
  assert.equal(calls, 1);
  http.destroy();
});
test("malformed streaming UTF8 cancels the response reader rather than retaining a live body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const http = createWebsiteHttp({
    siteId,
    fetchImpl: async () => new Response(stream),
  });
  assert.deepEqual(await http.submit(intent()), {
    kind: "unavailable",
    retryable: true,
  });
  assert(cancelled);
  http.destroy();
});

let app,
  cdn,
  api,
  appOrigin,
  cdnOrigin,
  apiOrigin,
  browser,
  fixtureJs,
  fixtureManifest,
  reactJs;
let nextOrigin;
const calls = [];
let publication,
  failObservations = false,
  lostAck = false,
  responsePlan = [];
const evidence = new URL("../.artifacts/website-entry/", import.meta.url);
const listen = async (server) => {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${server.address().port}`;
};
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
before(async () => {
  api = createServer(async (req, res) => {
    const call = { method: req.method, path: req.url, headers: req.headers };
    calls.push(call);
    res.setHeader(
      "Access-Control-Allow-Origin",
      req.headers.origin === nextOrigin ? nextOrigin : appOrigin,
    );
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "60",
      });
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    call.body = JSON.parse(body);
    if (req.url.endsWith("/observations")) {
      if (failObservations) {
        call.status = 503;
        json(res, 503, { error: "website_collection_unavailable" });
        return;
      }
      json(res, 200, {
        disposition: "accepted",
        eventId: call.body.eventId,
        recordId: "protocol-fixture",
        receivedAt: new Date().toISOString(),
      });
      return;
    }
    if (lostAck) {
      lostAck = false;
      // An incomplete acknowledgement follows the recorded original request.
      // Unlike an early socket close this cannot trigger Chrome's TCP retry.
      res.writeHead(201, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end('{"kind":"received"');
      return;
    }
    const [status, result] = responsePlan.shift() ?? [
      201,
      { kind: "received", submissionId },
    ];
    json(res, status, result);
  });
  apiOrigin = await listen(api);
  cdn = createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url, headers: req.headers });
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url.endsWith("/settings")) {
      json(res, 200, publication);
      return;
    }
    if (req.url.endsWith("/forms.css")) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(
        await readFile(
          new URL("../packages/core/src/website/forms.css", import.meta.url),
        ),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(req.url === "/react-loader.js" ? reactJs : fixtureJs);
  });
  cdnOrigin = await listen(cdn);
  app = createServer((req, res) => {
    const url = new URL(req.url, appOrigin);
    const site = url.searchParams.get("site") ?? siteId;
    const external = url.searchParams.has("external")
      ? ' data-fonte-consent="external"'
      : "";
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy": `default-src 'none'; script-src ${cdnOrigin} https://cdn.fonte.is; style-src ${cdnOrigin}; connect-src ${cdnOrigin} ${apiOrigin}`,
    });
    res.end(
      `<!doctype html><html><head></head><body><div id="react"></div><div data-fonte-placement="newsletter"></div>${url.searchParams.has("react") ? `<script src="${cdnOrigin}/react-loader.js"></script>` : `<script async src="${cdnOrigin}/v1.js" data-fonte-site="${site}"${external}></script>`}</body></html>`,
    );
  });
  appOrigin = await listen(app);
  publication = settings(appOrigin);
  execFileSync(
    process.execPath,
    [
      "scripts/build-website.mjs",
      "--fixture",
      "--cdn-origin",
      cdnOrigin,
      "--api-origin",
      apiOrigin,
      "--out-dir",
      ".artifacts/website-fixture",
    ],
    { stdio: "pipe" },
  );
  fixtureJs = await readFile(
    new URL("../.artifacts/website-fixture/v1.js", import.meta.url),
  );
  fixtureManifest = JSON.parse(
    await readFile(
      new URL("../.artifacts/website-fixture/manifest.json", import.meta.url),
    ),
  );
  const react = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {Fonte} from "./packages/react/src/website.tsx"; const root=createRoot(document.getElementById("react")); window.renderFonte=(count=2,consent)=>root.render(React.createElement(React.StrictMode,null,...Array.from({length:count},(_,i)=>React.createElement(Fonte,{key:i,site:${JSON.stringify(siteId)},consent})))); window.unmountFonte=()=>root.unmount(); window.renderFonte();`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  reactJs = react.outputFiles[0].contents;
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: "chrome" }),
  });
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL("profile.json", evidence),
    JSON.stringify(
      {
        scope:
          "Built client protocol fixtures only; real Core qualification is separate",
        browser: browser.version(),
        fixtureManifest,
      },
      null,
      2,
    ),
  );
});
after(async () => {
  await browser?.close();
  for (const server of [app, cdn, api]) {
    server?.closeAllConnections();
    if (server) await new Promise((done) => server.close(done));
  }
});
async function page(t, query = "", earlyRecord) {
  publication = settings(appOrigin);
  failObservations = false;
  lostAck = false;
  responsePlan = [];
  calls.length = 0;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  if (query.includes("react"))
    await page.route("https://cdn.fonte.is/v1.js", (route) =>
      route.fulfill({ body: fixtureJs, contentType: "application/javascript" }),
    );
  await context.addCookies([
    { name: "synthetic_auth", value: "fixture-only", url: appOrigin },
  ]);
  await page.addInitScript(
    ({ earlyRecord }) => {
      window.identityReads = 0;
      window.identityWrites = 0;
      window.ids = 0;
      window.violations = [];
      for (const name of ["localStorage", "sessionStorage"])
        Object.defineProperty(window, name, {
          get() {
            window.identityReads++;
            throw Error("blocked_storage");
          },
        });
      Object.defineProperty(document, "cookie", {
        get() {
          window.identityReads++;
          return "";
        },
        set() {
          window.identityWrites++;
        },
      });
      const uuid = crypto.randomUUID.bind(crypto);
      crypto.randomUUID = () => {
        window.ids++;
        return uuid();
      };
      if (earlyRecord !== undefined)
        window[Symbol.for("fonte.website.consent.v1")] = earlyRecord;
      document.addEventListener("securitypolicyviolation", (event) =>
        window.violations.push(event.violatedDirective),
      );
    },
    { earlyRecord },
  );
  await page.goto(`${appOrigin}/${query}`);
  return page;
}
const ready = (page) =>
  page.waitForFunction(() => window.fonte?.getStatus().state === "ready");
const observed = () =>
  calls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/observations"),
  );
const submitted = () =>
  calls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/submissions"),
  );
async function submit(page) {
  await page.locator('input[type="email"]').fill("synthetic@example.test");
  await page.locator('button[type="submit"]').click();
}

test("built async script: external hold, strict CSP, zero identity; Forms use real CORS without acquisition", async (t) => {
  const p = await page(t, "?external");
  await ready(p);
  assert.equal(
    await p.evaluate(() => window.fonte.getStatus().collection),
    "denied",
  );
  assert.deepEqual(
    await p.evaluate(() => [identityReads, identityWrites, ids]),
    [0, 0, 0],
  );
  assert.equal(observed().length, 0);
  await submit(p);
  await p
    .getByText("Your request has been received.", { exact: true })
    .waitFor();
  assert.equal(submitted().length, 1);
  assert(
    calls.some(
      (call) => call.method === "OPTIONS" && call.path.endsWith("/submissions"),
    ),
  );
  for (const call of calls.filter((call) =>
    /settings$|observations$|submissions$/.test(call.path),
  )) {
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers.referer, undefined);
  }
  assert.deepEqual(await p.evaluate(() => window.violations), []);
  assert.equal(
    await p.evaluate(() => window.fonte.getStatus().runtimeVersion),
    fixtureManifest.releaseDigest,
  );
});
for (const record of [
  undefined,
  { siteId, status: "unknown" },
  { siteId: otherSiteId, status: "granted" },
  { siteId, status: "granted", extra: true },
  { siteId, status: "denied" },
])
  test(`external early record ${JSON.stringify(record)} cannot enable collection`, async (t) => {
    const p = await page(t, "?external", record);
    await ready(p);
    assert.equal(
      await p.evaluate(() => window.fonte.getStatus().collection),
      "denied",
    );
    assert.equal(observed().length, 0);
    assert.equal(await p.evaluate(() => ids), 0);
    await p.evaluate(() => {
      fonte.setConsent("unknown");
      history.pushState({}, "", "/later");
    });
    assert.equal(
      await p.evaluate(() => fonte.getStatus().collection),
      "denied",
    );
    assert.equal(observed().length, 0);
  });
test("later grant never replays arrival; navigation collects then withdrawal stops; duplicate ignores stale choice", async (t) => {
  const p = await page(t, "?external");
  await ready(p);
  await p.evaluate(() => fonte.setConsent("granted"));
  assert.equal(observed().length, 0);
  await p.evaluate(() =>
    history.pushState({}, "", "/later?utm_source=fixture"),
  );
  await p.waitForFunction(
    () =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.endsWith("/observations")).length >= 2,
  );
  const count = observed().length;
  assert.equal(count, 2);
  await p.evaluate(
    ({ cdnOrigin, siteId }) => {
      window.originalFonte = fonte;
      window[Symbol.for("fonte.website.consent.v1")] = {
        siteId,
        status: "denied",
      };
      const tag = document.createElement("script");
      tag.src = cdnOrigin + "/v1.js";
      tag.dataset.fonteSite = siteId;
      tag.dataset.fonteConsent = "external";
      document.head.append(tag);
    },
    { cdnOrigin, siteId },
  );
  await p.waitForFunction(() => document.scripts.length === 2);
  await p.waitForTimeout(100);
  assert(await p.evaluate(() => originalFonte === fonte));
  assert.equal(await p.evaluate(() => fonte.getStatus().collection), "enabled");
  await p.evaluate(() => {
    fonte.setConsent("denied");
    history.pushState({}, "", "/denied");
  });
  assert.equal(observed().length, count);
});
test("immediate granted record permits automatic source; no external marker ignores remembered record", async (t) => {
  const p = await page(t, "?external&utm_source=fixture", {
    siteId,
    status: "granted",
  });
  await ready(p);
  await p.waitForFunction(() => fonte.getStatus().collection === "enabled");
  await p.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((e) => e.name.endsWith("/observations")),
  );
  assert(observed().length > 0);
});
test("lost HTTP acknowledgement retries the same browser intent", async (t) => {
  const p = await page(t, "?external");
  await ready(p);
  lostAck = true;
  await submit(p);
  await p
    .getByText("Your request could not be confirmed. You can retry.", {
      exact: true,
    })
    .waitFor();
  await p.locator('button[type="submit"]').click();
  await p
    .getByText("Your request has been received.", { exact: true })
    .waitFor();
  assert.equal(submitted().length, 2);
  assert.deepEqual(submitted()[0].body, submitted()[1].body);
});
test("duplicate/conflicting tags, missing ID and unrelated global are contained; destroy/reinit reapplies hold", async (t) => {
  const p = await page(t, "?external");
  await ready(p);
  const messages = [];
  p.on("console", (msg) => messages.push(msg.text()));
  await p.evaluate(
    ({ cdnOrigin, siteId, otherSiteId }) => {
      for (const [site, external] of [
        [siteId, false],
        [otherSiteId, true],
        ["", false],
      ]) {
        const script = document.createElement("script");
        script.src = cdnOrigin + "/v1.js";
        script.dataset.fonteSite = site;
        if (external) script.dataset.fonteConsent = "external";
        document.head.append(script);
      }
    },
    { cdnOrigin, siteId, otherSiteId },
  );
  await p.waitForTimeout(150);
  assert(messages.some((m) => m.includes("consent_mode_conflict")));
  assert(messages.some((m) => m.includes("site_conflict")));
  assert(messages.some((m) => m.includes("invalid_site")));
  await p.evaluate(
    ({ cdnOrigin, siteId }) => {
      fonte.destroy();
      window.fonte = { hostOwned: true };
      const script = document.createElement("script");
      script.src = cdnOrigin + "/v1.js";
      script.dataset.fonteSite = siteId;
      script.dataset.fonteConsent = "external";
      document.head.append(script);
    },
    { cdnOrigin, siteId },
  );
  await p.waitForFunction(
    () =>
      window[Symbol.for("fonte.website.v1")]?.runtime.getStatus().state ===
      "ready",
  );
  assert(await p.evaluate(() => fonte.hostOwned));
  assert.equal(
    await p.evaluate(
      () =>
        window[Symbol.for("fonte.website.v1")].runtime.getStatus().collection,
    ),
    "denied",
  );
});
test("React Strict Mode duplicates/unmount load one permanent script and retain installed navigation", async (t) => {
  const p = await page(t, "?react");
  await p.route("https://cdn.fonte.is/v1.js", (route) =>
    route.fulfill({ body: fixtureJs, contentType: "application/javascript" }),
  );
  await p.reload();
  await ready(p);
  assert.equal(
    await p.evaluate(
      () =>
        [...document.scripts].filter(
          (s) => s.src === "https://cdn.fonte.is/v1.js",
        ).length,
    ),
    1,
  );
  const count = calls.filter((c) => c.path.endsWith("/settings")).length;
  await p.evaluate(() => renderFonte(1));
  await p.waitForTimeout(100);
  await p.evaluate(() => unmountFonte());
  assert.equal(await p.evaluate(() => fonte.getStatus().state), "ready");
  await p.evaluate(() =>
    history.pushState({}, "", "/after-unmount?utm_source=fixture"),
  );
  await p.waitForFunction(() => fonte.getStatus().forms.mounted === 1);
  assert.equal(calls.filter((c) => c.path.endsWith("/settings")).length, count);
});
test("artifact is one IIFE plus pinned CSS; no React, eval, private credential or arbitrary endpoint", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../.artifacts/website/manifest.json", import.meta.url),
    ),
  );
  const js = await readFile(
    new URL("../.artifacts/website/v1.js", import.meta.url),
    "utf8",
  );
  assert.equal(manifest.fixture, false);
  assert.equal(manifest.cdnOrigin, "https://cdn.fonte.is");
  assert.equal(manifest.apiOrigin, "https://api.fonte.is");
  assert.equal(manifest.assets.length, 3);
  assert(js.includes(manifest.releaseDigest));
  assert(js.includes("/forms.css"));
  assert(
    !/React|react-dom|FONTE_CONTACT|SECRET_KEY|Authorization|eval\(/.test(js),
  );
  assert(
    !Object.keys(manifest.inputs).some((name) =>
      /packages\/(react|nextjs|cli)\//.test(name),
    ),
  );
  assert.equal(manifest.assets[0].sha256, manifest.assets[1].sha256);
});

test("nonexternal automatic ignores a remembered denial; acquisition outage cannot block signup", async (t) => {
  const p = await page(t, "?utm_source=fixture", { siteId, status: "denied" });
  failObservations = true;
  await ready(p);
  assert.equal(await p.evaluate(() => fonte.getStatus().collection), "enabled");
  await p.evaluate(() =>
    history.pushState({}, "", "/collector-unavailable?utm_source=fixture"),
  );
  await submit(p);
  await p
    .getByText("Your request has been received.", { exact: true })
    .waitFor();
  assert.equal(submitted().length, 1);
  assert(observed().some((call) => call.status === 503));
});
test("explicit remembered denial returns after reload while CMP restoration is delayed", async (t) => {
  const p = await page(t, "?external", { siteId, status: "denied" });
  await ready(p);
  await p.evaluate(() => fonte.setConsent("granted"));
  await p.reload();
  await ready(p);
  assert.equal(await p.evaluate(() => fonte.getStatus().collection), "denied");
  assert.equal(observed().length, 0);
  assert.deepEqual(
    await p.evaluate(() => [identityReads, identityWrites, ids]),
    [0, 0, 0],
  );
});
test("Next consumer loads the built hosted script and retains one installation across client navigation", async (t) => {
  const directory = new URL("../.artifacts/website-next/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await cp(new URL("./consumers/nextjs/", import.meta.url), directory, {
    recursive: true,
  });
  await writeFile(
    new URL("package.json", directory),
    JSON.stringify({
      name: "website-next-consumer",
      private: true,
      type: "module",
    }),
  );
  const { symlink } = await import("node:fs/promises");
  await symlink(
    new URL("../node_modules", import.meta.url).pathname,
    new URL("node_modules", directory),
  ).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const probe = createServer();
  const temporary = await listen(probe);
  const port = new URL(temporary).port;
  await new Promise((done) => probe.close(done));
  nextOrigin = `http://127.0.0.1:${port}`;
  publication = settings(nextOrigin);
  calls.length = 0;
  const process = spawn(
    globalThis.process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      port,
    ],
    {
      cwd: directory,
      env: {
        ...globalThis.process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        FONTE_WEBSITE_SITE: siteId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  process.stdout.on("data", (data) => {
    output += data;
  });
  process.stderr.on("data", (data) => {
    output += data;
  });
  t.after(async () => {
    process.kill("SIGTERM");
    await new Promise((done) => {
      if (process.exitCode !== null) done();
      else process.once("exit", done);
    });
    nextOrigin = undefined;
  });
  let online = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (process.exitCode !== null)
      throw Error(`Next consumer failed: ${output}`);
    try {
      const response = await fetch(nextOrigin, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        online = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  assert(online, output);
  const context = await browser.newContext();
  t.after(() => context.close());
  const p = await context.newPage();
  await p.route("https://cdn.fonte.is/v1.js", (route) =>
    route.fulfill({ body: fixtureJs, contentType: "application/javascript" }),
  );
  await p.goto(nextOrigin, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await p.waitForFunction(
    () => window.fonte?.getStatus().state === "ready",
    null,
    { timeout: 120_000 },
  );
  assert.equal(await p.evaluate(() => fonte.getStatus().collection), "denied");
  await submit(p);
  await p
    .getByText("Your request has been received.", { exact: true })
    .waitFor();
  await p.evaluate(() => {
    window.firstRuntime = fonte;
  });
  await p.click("#second-link");
  await p.waitForURL(/\/second\?utm_source=route$/);
  assert(await p.evaluate(() => firstRuntime === fonte));
  assert.equal(
    await p.evaluate(
      () =>
        [...document.scripts].filter(
          (s) => s.src === "https://cdn.fonte.is/v1.js",
        ).length,
    ),
    1,
  );
  assert.equal(observed().length, 0);
  assert.equal(submitted().length, 1);
  await writeFile(
    new URL("next-receipt.json", evidence),
    JSON.stringify({
      scope:
        "Actual Next client using built script and declared HTTP protocol fixture; no real Core acceptance claimed",
      origin: nextOrigin,
      browser: browser.version(),
      scriptRequests: 1,
      submissionRequests: 1,
    }),
  );
});
