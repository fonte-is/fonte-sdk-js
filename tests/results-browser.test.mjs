import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import { createFonte } from "@fonte-is/core/results";
import { recordFonteReturn } from "@fonte-is/core/results-browser";

const at = "2026-10-06T10:00:00.000Z",
  time = Date.parse(at);
const installationId = "installation-example",
  serverKey = "synthetic-only-native-key-123456789";
const eventId = "11111111-1111-4111-8111-111111111111";
function browserIdentity(extra = {}) {
  const value = createFonte({
    installationId,
    serverKey,
    now: () => time,
    flushDelayMs: 1000,
    fetch: async () => {
      throw Error("fixture must not drain");
    },
  });
  const identity = value.identify(
    { id: "app-user-1", email: "controlled@example.test", emailVerified: true },
    { measurementAllowed: true, eventId, occurredAt: at, ...extra },
  ).browserIdentity;
  value.close();
  return identity;
}
function browser(t, visibilityState = "visible", hidden = false) {
  const restore = [];
  for (const [name, value] of [
    ["window", {}],
    ["document", { visibilityState, hidden }],
  ]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() =>
      previous
        ? Object.defineProperty(globalThis, name, previous)
        : delete globalThis[name],
    );
  }
  t.after(() => restore.reverse().forEach((reset) => reset()));
}
const receipt = (identity, record, extra = {}) => ({
  schema: "fonte.application.receipt.v2",
  sourceId: identity.installationId,
  acceptedAt: at,
  records: [{ eventId: record.eventId, outcome: "stored" }],
  delivery: "best_effort",
  ...extra,
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const options = (extra) => ({ now: () => time + 1000, ...extra });
function alteredClaims(identity, change) {
  const [encoded, signature] = identity.identityToken.split(".");
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  change(claims);
  return {
    ...identity,
    identityToken: `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`,
  };
}

test("Return outside a visible document avoids reading identity or invoking fetch", (t) => {
  let reads = 0,
    requests = 0;
  const unread = new Proxy(
    {},
    {
      get() {
        reads++;
        throw 0;
      },
      ownKeys() {
        reads++;
        throw 0;
      },
    },
  );
  const fetch = () => {
    requests++;
    throw 0;
  };
  assert.equal(recordFonteReturn(unread, options({ fetch })), false);
  browser(t, "hidden", true);
  assert.equal(recordFonteReturn(unread, options({ fetch })), false);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "prerender", hidden: false },
  });
  assert.equal(recordFonteReturn(unread, options({ fetch })), false);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible", hidden: true },
  });
  assert.equal(recordFonteReturn(unread, options({ fetch })), false);
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test("visible Return sends exact Return-only JSON without credentials or customer authority headers", async (t) => {
  const identity = browserIdentity();
  browser(t);
  const requests = [];
  assert.equal(
    recordFonteReturn(
      identity,
      options({
        fetch: async (url, init) => {
          const body = JSON.parse(init.body);
          requests.push({ url, init, body });
          return Response.json(receipt(identity, body.record));
        },
      }),
    ),
    true,
  );
  assert.equal(
    requests.length,
    0,
    "synchronous Return must not await transport",
  );
  await delay(10);
  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(url, "https://api.fonte.is/v1/application-returns");
  assert.deepEqual(init.headers, { "Content-Type": "application/json" });
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.deepEqual(Object.keys(body), ["identityToken", "record"]);
  assert.equal(body.identityToken, identity.identityToken);
  assert.deepEqual(
    { ...body.record, eventId: "generated" },
    {
      kind: "return",
      eventId: "generated",
      occurredAt: "2026-10-06T10:00:01.000Z",
      userId: "app-user-1",
      identityEventId: eventId,
      foreground: true,
    },
  );
  assert.match(
    body.record.eventId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert(!init.body.includes(serverKey));
  assert(!init.body.includes("controlled@example.test"));
});

test("browser original UUID, time and token survive lost responses byte for byte", async (t) => {
  const identity = browserIdentity();
  browser(t);
  let now = time + 1000,
    finish;
  const done = new Promise((resolve) => {
      finish = resolve;
    }),
    requests = [];
  assert(
    recordFonteReturn(identity, {
      now: () => now,
      fetch: async (_url, init) => {
        requests.push(init.body);
        now += 1000;
        if (requests.length === 1) throw Error("lost after accept");
        const body = JSON.parse(init.body);
        finish();
        return Response.json(receipt(identity, body.record));
      },
    }),
  );
  await done;
  await delay(0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(
    JSON.parse(requests[0]).record.occurredAt,
    "2026-10-06T10:00:01.000Z",
  );
});

test("browser retries are at most three after the first attempt and stop without polling", async (t) => {
  const identity = browserIdentity();
  browser(t);
  const requests = [];
  let fourth;
  const done = new Promise((resolve) => {
    fourth = resolve;
  });
  assert(
    recordFonteReturn(
      identity,
      options({
        fetch: async (_url, init) => {
          requests.push(init.body);
          if (requests.length === 4) fourth();
          return new Response(null, { status: 503 });
        },
      }),
    ),
  );
  await done;
  await delay(125);
  assert.equal(requests.length, 4);
  assert.equal(new Set(requests).size, 1);
});

for (const status of [400, 403, 409])
  test(`browser permanent ${status} denies further transport without throwing into the page`, async (t) => {
    const identity = browserIdentity();
    browser(t);
    let calls = 0;
    assert.doesNotThrow(() =>
      assert.equal(
        recordFonteReturn(
          identity,
          options({
            fetch: async () => {
              calls++;
              return new Response(null, { status });
            },
          }),
        ),
        true,
      ),
    );
    await delay(120);
    assert.equal(calls, 1);
  });

test("browser malformed receipt is uncertain and retries the same Return", async (t) => {
  const identity = browserIdentity();
  browser(t);
  const requests = [];
  let second;
  const done = new Promise((resolve) => {
    second = resolve;
  });
  assert(
    recordFonteReturn(
      identity,
      options({
        fetch: async (_url, init) => {
          requests.push(init.body);
          const body = JSON.parse(init.body);
          if (requests.length === 1)
            return Response.json(
              receipt(identity, body.record, {
                sourceId: "wrong-installation",
              }),
            );
          second();
          return Response.json(receipt(identity, body.record));
        },
      }),
    ),
  );
  await done;
  await delay(0);
  assert.equal(requests[0], requests[1]);
  assert.equal(requests.length, 2);
});

test("browser timeout is 750 ms and recovery retains the original Return", async (t) => {
  const identity = browserIdentity();
  browser(t);
  const requests = [];
  let firstSignal, second;
  const done = new Promise((resolve) => {
    second = resolve;
  });
  assert(
    recordFonteReturn(
      identity,
      options({
        fetch: (_url, init) => {
          requests.push(init.body);
          if (requests.length === 1) {
            firstSignal = init.signal;
            return new Promise(() => {});
          }
          second();
          return Promise.resolve(
            Response.json(receipt(identity, JSON.parse(init.body).record)),
          );
        },
      }),
    ),
  );
  await delay(30);
  assert.equal(firstSignal.aborted, false);
  await done;
  await delay(0);
  assert.equal(firstSignal.aborted, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
});

test("browser long Retry-After ends this best-effort attempt without an automatic delayed poll", async (t) => {
  const identity = browserIdentity();
  browser(t);
  let requests = 0;
  assert(
    recordFonteReturn(
      identity,
      options({
        fetch: async () => {
          requests++;
          return new Response(null, {
            status: 429,
            headers: { "Retry-After": "30" },
          });
        },
      }),
    ),
  );
  await delay(120);
  assert.equal(requests, 1);
});

test("browser expiry and exact signed identity metadata fail closed before transport", (t) => {
  const identity = browserIdentity();
  browser(t);
  let calls = 0;
  const fetch = () => {
    calls++;
    throw Error("must not request");
  };
  assert.equal(
    recordFonteReturn(identity, { now: () => time + 900_000, fetch }),
    false,
  );
  assert.equal(
    recordFonteReturn(identity, { now: () => time - 1, fetch }),
    false,
  );
  for (const extra of [
    { installationId: "other" },
    { userId: "other" },
    { identityEventId: "22222222-2222-4222-8222-222222222222" },
    { validUntil: "2026-10-06T10:14:00Z" },
    { identityToken: "invalid" },
    { identityToken: `${identity.identityToken}=` },
    { identityToken: "x".repeat(4097) },
    { identityToken: `${identity.identityToken}\n` },
    { record: { kind: "trigger" } },
    { serverKey },
    { contactId: "caller" },
  ]) {
    assert.equal(
      recordFonteReturn({ ...identity, ...extra }, options({ fetch })),
      false,
    );
  }
  for (const mutate of [
    (c) => {
      c.measurementAllowed = false;
    },
    (c) => {
      c.measurementAllowed = "true";
    },
    (c) => {
      c.schema = "other";
    },
    (c) => {
      c.identity.kind = "trigger";
    },
    (c) => {
      c.identity.user.id = "other";
    },
    (c) => {
      c.identity.accountId = "caller";
    },
    (c) => {
      c.identity.validUntil = "2026-10-06T10:16:00Z";
    },
    (c) => {
      c.identity.user.emailVerified = "true";
    },
    (c) => {
      c.workspaceId = "caller";
    },
  ]) {
    assert.equal(
      recordFonteReturn(alteredClaims(identity, mutate), options({ fetch })),
      false,
    );
  }
  assert.equal(calls, 0);
});

test("browser has no generic trigger, success, token override or storage API", (t) => {
  const identity = browserIdentity();
  browser(t);
  let requests = 0;
  const fetch = () => {
    requests++;
    throw 0;
  };
  for (const extra of [
    { trigger: "project_created" },
    { successful: true },
    { record: { kind: "trigger" } },
    { eventId: "caller-event" },
    { identityToken: identity.identityToken },
    { properties: {} },
    { headers: { "x-fonte-installation-key": serverKey } },
  ]) {
    assert.equal(
      recordFonteReturn(identity, options({ fetch, ...extra })),
      false,
    );
  }
  assert.equal(requests, 0);
});

test("invalid browser inputs, configuration and thrown getters never throw or leak", (t) => {
  const identity = browserIdentity();
  browser(t);
  let requests = 0;
  const fetch = () => {
    requests++;
    throw Error(`${serverKey}:${identity.identityToken}`);
  };
  const malformed = new Proxy(
    {},
    {
      get() {
        throw Error(serverKey);
      },
      ownKeys() {
        throw Error(identity.identityToken);
      },
    },
  );
  for (const value of [null, undefined, {}, [], malformed])
    assert.doesNotThrow(() =>
      assert.equal(recordFonteReturn(value, options({ fetch })), false),
    );
  for (const o of [
    null,
    malformed,
    { fetch: "invalid" },
    { now: "invalid" },
    { apiOrigin: `https://user:${serverKey}@api.example.test` },
    { apiOrigin: "http://evil.example.test" },
    { apiOrigin: "https://api.example.test/path" },
  ]) {
    assert.doesNotThrow(() =>
      assert.equal(recordFonteReturn(identity, o), false),
    );
  }
  assert.equal(requests, 0);
});

test("browser uses normalized UTF-8 claims and passes unverified email honestly", async (t) => {
  const source = createFonte({
    installationId,
    serverKey,
    now: () => time,
    flushDelayMs: 1000,
  });
  const handle = source.identify(
    {
      id: "unicode-email-user",
      email: "ÉTÉ@EXAMPLE.TEST",
      emailVerified: false,
    },
    { measurementAllowed: true, eventId, occurredAt: at },
  );
  const identity = handle.browserIdentity;
  source.close();
  browser(t);
  let requests = 0;
  assert(
    recordFonteReturn(
      identity,
      options({
        fetch: async (_url, init) => {
          requests++;
          return Response.json(receipt(identity, JSON.parse(init.body).record));
        },
      }),
    ),
  );
  await delay(10);
  assert.equal(requests, 1);
  const decoded = JSON.parse(
    Buffer.from(identity.identityToken.split(".")[0], "base64url").toString(
      "utf8",
    ),
  );
  assert.equal(decoded.identity.user.email, "été@example.test");
  assert.equal(decoded.identity.user.emailVerified, false);
});

test("a forged signature supplies no local authority and permanent denial stops delivery", async (t) => {
  const identity = browserIdentity();
  browser(t);
  let requests = 0;
  const forged = {
    ...identity,
    identityToken: `${identity.identityToken.split(".")[0]}.${"A".repeat(43)}`,
  };
  assert.doesNotThrow(() =>
    assert.equal(
      recordFonteReturn(
        forged,
        options({
          fetch: async () => {
            requests++;
            return new Response(null, { status: 403 });
          },
        }),
      ),
      true,
    ),
  );
  await delay(120);
  assert.equal(requests, 1);
  // Only Core, with the current private verifier and actual Origin, can authenticate this signature.
});

test("actual browser bundle excludes Node, server credentials, storage and server facade", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const bundle = await build({
    entryPoints: ["@fonte-is/core/results-browser"],
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "NativeReturn",
    metafile: true,
    logLevel: "silent",
  });
  const output = bundle.outputFiles[0].text;
  for (const forbidden of [
    "node:",
    "serverKey",
    "x-fonte-installation-key",
    "createHmac",
    "createFonte(",
    "Buffer",
    "localStorage",
    "document.cookie",
    serverKey,
  ])
    assert(!output.includes(forbidden), forbidden);
  assert(
    !Object.keys(bundle.metafile.inputs).some((file) =>
      /(?:^|\/)(?:results|application)\.ts$/.test(file),
    ),
  );
  await assert.rejects(
    build({
      stdin: {
        contents:
          "import {createFonte} from '@fonte-is/core/results'; console.log(createFonte);",
        resolveDir: root,
      },
      bundle: true,
      write: false,
      platform: "browser",
      logLevel: "silent",
    }),
    /Could not resolve/,
  );
  const identity = browserIdentity(),
    requests = [];
  const context = vm.createContext({
    window: {},
    document: { visibilityState: "visible", hidden: false },
    URL,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: webcrypto,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json(receipt(identity, JSON.parse(init.body).record));
    },
  });
  vm.runInContext(output, context);
  const emitted = vm.runInContext(
    `NativeReturn.recordFonteReturn(${JSON.stringify(identity)}, {now: () => ${time + 1000}})`,
    context,
  );
  assert.equal(emitted, true);
  await delay(10);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].record.kind, "return");
});

test("browser actual loopback HTTP sends JSON Return and stable bytes after a lost receipt", async (t) => {
  const identity = browserIdentity(),
    requests = [];
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    const raw = Buffer.concat(parts).toString("utf8"),
      body = JSON.parse(raw);
    requests.push({ raw, body, path: request.url, headers: request.headers });
    if (requests.length === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(receipt(identity, body.record)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  browser(t);
  assert(
    recordFonteReturn(
      identity,
      options({
        apiOrigin: `http://127.0.0.1:${server.address().port}`,
        allowInsecureLocalhost: true,
        fetch: globalThis.fetch,
      }),
    ),
  );
  for (let n = 0; n < 200 && requests.length < 2; n++) await delay(5);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].raw, requests[1].raw);
  for (const request of requests) {
    assert.equal(request.path, "/v1/application-returns");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-fonte-installation-key"], undefined);
    assert.equal(request.headers["x-fonte-installation-id"], undefined);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.body.record.kind, "return");
  }
});
