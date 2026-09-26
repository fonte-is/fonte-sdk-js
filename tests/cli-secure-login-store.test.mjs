import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../packages/cli/dist/canonical-json.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import {
  OperatingSystemLoginStore,
  createOperatingSystemLoginStore,
} from "../packages/cli/dist/secure-login-store.js";

const baseRecord = {
  binding: {
    clientId: "fonte-cli",
    coreApiTarget: "https://api.example.test",
    issuer: "https://identity.example.test",
    redirectUri: "http://127.0.0.1/callback",
    scopes: ["openid", "profile"],
  },
  epoch: "10000000-0000-4000-8000-000000000001",
  generation: 7,
  loginId: "20000000-0000-4000-8000-000000000002",
  refreshToken: "synthetic-refresh",
  schema: "fonte.client_session.v1",
  state: "ready",
  subject: "synthetic-subject",
};

test("the adapter loads lazily and only item-not-found is absence", async () => {
  const model = nativeModel();
  const store = model.store();
  assert.equal(model.loads, 0);
  assert.equal(await store.read({ allowInteraction: false }), null);
  assert.equal(model.loads, 1);
  assert.deepEqual(model.operations, ["read"]);

  model.readFailure = tagged("item_not_found", "secret provider detail");
  assert.equal(await store.read({ allowInteraction: false }), null);
  assert.equal(model.loads, 1);
  assert.ok(
    createOperatingSystemLoginStore() instanceof OperatingSystemLoginStore,
  );
});

test("replacement is canonical, exact, and record-aware about interaction", async () => {
  const model = nativeModel();
  const store = model.store();
  await store.replace(baseRecord, { allowInteraction: true });
  assert.equal(model.permitInteraction, true);
  assert.equal(model.payload.toString("utf8"), canonicalJson(baseRecord));
  assert.deepEqual(model.operations, ["replace", "read"]);
  assert.deepEqual(await store.read({ allowInteraction: false }), baseRecord);

  for (const [state, allowed] of [
    ["login_pending", true],
    ["ready", true],
    ["refresh_pending", false],
    ["refresh_uncertain", false],
    ["revoked", false],
    ["signed_out", false],
  ]) {
    const fixture = recordForState(state);
    const interactive = nativeModel();
    await interactive.store().replace(fixture, { allowInteraction: true });
    assert.equal(interactive.permitInteraction, allowed, state);

    const explicitNo = nativeModel();
    await explicitNo.store().replace(fixture, { allowInteraction: false });
    assert.equal(explicitNo.permitInteraction, false, state);

    const environmentNo = nativeModel({ noninteractive: true });
    await environmentNo.store().replace(fixture, {
      allowInteraction: true,
    });
    assert.equal(environmentNo.permitInteraction, false, state);
  }
});

test("2,400 bytes is accepted and 2,401 is rejected without dispatch", async () => {
  const accepted = nativeModel();
  const exact = recordWithBytes(2_400);
  await accepted.store().replace(exact, { allowInteraction: false });
  assert.equal(accepted.payload.byteLength, 2_400);

  const rejected = nativeModel();
  await assert.rejects(
    rejected.store().replace(recordWithBytes(2_401), {
      allowInteraction: false,
    }),
    blocked("login_invalid"),
  );
  assert.deepEqual(rejected.operations, []);
  assert.equal(rejected.payload, null);
});

test("corrupt bytes, schema, canonical form, duplicates, and oversize reads are invalid", async () => {
  const corruptPayloads = [
    Buffer.from([0xff]),
    Buffer.from('{"schema":"wrong"}', "utf8"),
    Buffer.from(` ${canonicalJson(baseRecord)}`, "utf8"),
    Buffer.alloc(2_401, 0x78),
  ];
  for (const payload of corruptPayloads) {
    const model = nativeModel();
    model.payload = payload;
    await assert.rejects(
      model.store().read({ allowInteraction: false }),
      blocked("login_invalid"),
    );
  }

  for (const code of ["invalid", "duplicate", "wrong_metadata"]) {
    const model = nativeModel();
    model.readFailure = tagged(code, canonicalJson(baseRecord));
    await assert.rejects(
      model.store().read({ allowInteraction: false }),
      blocked("login_invalid"),
    );
  }
});

test("native failures are mapped and sanitized without provider diagnostics", async () => {
  for (const code of ["interaction_required", "locked", "prompt_required"]) {
    const model = nativeModel();
    model.readFailure = tagged(code, canonicalJson(baseRecord));
    await assert.rejects(
      model.store().read({ allowInteraction: false }),
      blocked("secure_storage_interaction_required"),
    );
  }
  for (const code of ["unavailable", "permission_denied", "facility_failure"]) {
    const model = nativeModel();
    model.readFailure = tagged(code, canonicalJson(baseRecord));
    await assert.rejects(
      model.store().read({ allowInteraction: false }),
      blocked("secure_storage_unavailable"),
    );
  }

  const failedLoad = new OperatingSystemLoginStore(async () => {
    throw new Error(`load leaked ${canonicalJson(baseRecord)}`);
  });
  await assert.rejects(
    failedLoad.read({ allowInteraction: false }),
    blocked("secure_storage_unavailable"),
  );
});

test("replacement never truncates and requires byte-for-byte readback", async () => {
  const changed = nativeModel();
  changed.mutateReadback = (payload) =>
    Buffer.concat([payload, Buffer.from(" ")]);
  await assert.rejects(
    changed.store().replace(baseRecord, { allowInteraction: false }),
    blocked("login_invalid"),
  );

  const absent = nativeModel();
  absent.discardReplace = true;
  await assert.rejects(
    absent.store().replace(baseRecord, { allowInteraction: false }),
    blocked("login_invalid"),
  );

  const uncertain = nativeModel();
  uncertain.replaceFailure = tagged(
    "permission_denied",
    canonicalJson(baseRecord),
  );
  await assert.rejects(
    uncertain.store().replace(baseRecord, { allowInteraction: false }),
    blocked("secure_storage_unavailable"),
  );
  assert.deepEqual(uncertain.operations, ["replace"]);

  const unreadable = nativeModel();
  let reads = 0;
  unreadable.binding.read = async () => {
    unreadable.operations.push("read");
    reads += 1;
    if (reads === 1) throw tagged("locked", canonicalJson(baseRecord));
    return unreadable.payload;
  };
  await assert.rejects(
    unreadable.store().replace(baseRecord, { allowInteraction: false }),
    blocked("secure_storage_unavailable"),
  );
  assert.deepEqual(unreadable.operations, ["replace", "read"]);
});

test("signals fence load and dispatch while dispatched replacement is awaited", async () => {
  const beforeLoad = nativeModel();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    beforeLoad.store().read({
      allowInteraction: false,
      signal: alreadyAborted.signal,
    }),
    blocked("authorization_cancelled"),
  );
  assert.equal(beforeLoad.loads, 0);

  const afterLoad = nativeModel();
  const loadGate = deferred();
  afterLoad.loadGate = loadGate.promise;
  const between = new AbortController();
  const read = afterLoad.store().read({
    allowInteraction: false,
    signal: between.signal,
  });
  between.abort();
  loadGate.resolve();
  await assert.rejects(read, blocked("authorization_cancelled"));
  assert.deepEqual(afterLoad.operations, []);

  const afterDispatch = nativeModel();
  const replaceGate = deferred();
  afterDispatch.replaceGate = replaceGate.promise;
  const late = new AbortController();
  let settled = false;
  const replacement = afterDispatch
    .store()
    .replace(baseRecord, {
      allowInteraction: false,
      signal: late.signal,
    })
    .finally(() => {
      settled = true;
    });
  await afterDispatch.replaceStarted.promise;
  late.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  replaceGate.resolve();
  await assert.rejects(replacement, blocked("authorization_cancelled"));
  assert.deepEqual(afterDispatch.operations, ["replace", "read"]);
});

test("the compatibility wrapper uses the new record slot without implicit login", async () => {
  const model = nativeModel();
  const store = model.store();
  await store.write(canonicalJson(baseRecord));
  assert.equal(await store.read(), canonicalJson(baseRecord));
  await assert.rejects(store.remove(), blocked("secure_storage_unavailable"));
});

function nativeModel({ noninteractive = false } = {}) {
  const model = {
    loads: 0,
    operations: [],
    payload: null,
    permitInteraction: null,
    readFailure: null,
    replaceFailure: null,
    discardReplace: false,
    mutateReadback: (value) => value,
    loadGate: Promise.resolve(),
    replaceGate: Promise.resolve(),
    replaceStarted: deferred(),
  };
  model.binding = {
    ABI_NAME: "fonte.client_auth_store.native.v1",
    async read() {
      model.operations.push("read");
      if (model.readFailure) throw model.readFailure;
      return model.payload === null
        ? null
        : model.mutateReadback(model.payload);
    },
    async replace(payload, permitInteraction) {
      model.operations.push("replace");
      model.replaceStarted.resolve();
      await model.replaceGate;
      model.permitInteraction = permitInteraction;
      if (!model.discardReplace) model.payload = Buffer.from(payload);
      if (model.replaceFailure) throw model.replaceFailure;
    },
  };
  model.store = () =>
    new OperatingSystemLoginStore(
      async () => {
        model.loads += 1;
        await model.loadGate;
        return model.binding;
      },
      () => noninteractive,
    );
  return model;
}

function recordForState(state) {
  if (state === "signed_out") {
    return {
      epoch: baseRecord.epoch,
      generation: baseRecord.generation,
      schema: baseRecord.schema,
      state,
    };
  }
  if (state === "login_pending") {
    const { refreshToken, subject, ...pending } = baseRecord;
    return {
      ...pending,
      createdAt: 1_000,
      expiresAt: 301_000,
      state,
    };
  }
  return { ...baseRecord, state };
}

function recordWithBytes(target) {
  const empty = { ...baseRecord, refreshToken: "" };
  const overhead = Buffer.byteLength(canonicalJson(empty));
  return { ...empty, refreshToken: "x".repeat(target - overhead) };
}

function tagged(code, detail) {
  const error = new Error(detail);
  error.code = code;
  return error;
}

function blocked(reason) {
  return (error) => {
    assert.ok(error instanceof HostedTestBlockedError);
    assert.equal(error.reason, reason);
    assert.equal(error.message, reason);
    assert.equal(error.cause, undefined);
    assert.equal(String(error.stack).includes("synthetic-refresh"), false);
    return true;
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
