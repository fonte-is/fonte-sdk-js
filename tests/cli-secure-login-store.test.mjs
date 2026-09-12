import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import {
  OperatingSystemLoginStore,
  createOperatingSystemLoginStore,
} from "../packages/cli/dist/secure-login-store.js";

const syntheticSecret = '{"refreshToken":"synthetic-refresh-credential"}';

test("native custody survives adapter replacement and removal is read back", async () => {
  const model = nativeModel();
  const store = model.store();
  assert.equal(await store.read(), null);
  await store.write(syntheticSecret);
  assert.deepEqual(model.operations.slice(-2), ["write", "read"]);
  assert.equal(await model.store().read(), syntheticSecret);
  await model.store().remove();
  assert.deepEqual(model.operations.slice(-2), ["remove", "read"]);
  assert.equal(await store.read(), null);
  await store.remove();
  assert.equal(await store.read(), null);
});

test("missing native binding, locked store, and corrupt storage fail without leaking diagnostics", async () => {
  const absentBinding = new OperatingSystemLoginStore(
    `synthetic-${randomUUID()}`,
    "synthetic-login",
    async () => {
      throw new Error(`native load failed: ${syntheticSecret}`);
    },
    "darwin",
  );
  await assert.rejects(absentBinding.read(), storageUnavailable);
  for (const operation of ["read", "write", "remove"]) {
    const model = nativeModel();
    model.failure = operation;
    await assert.rejects(
      model.store()[operation](syntheticSecret),
      storageUnavailable,
    );
  }
  for (const value of ["", undefined, 42, "invalid\0credential"]) {
    const model = nativeModel();
    model.values.set(model.key, value);
    await assert.rejects(model.store().read(), storageUnavailable);
  }
});

test("write and deletion acknowledgements never substitute for credential readback", async () => {
  const discarded = nativeModel();
  discarded.discardWrite = true;
  await assert.rejects(
    discarded.store().write(syntheticSecret),
    storageUnavailable,
  );
  assert.equal(await discarded.store().read(), null);

  const retained = nativeModel();
  await retained.store().write(syntheticSecret);
  retained.discardRemoval = true;
  await assert.rejects(retained.store().remove(), storageUnavailable);
  assert.equal(await retained.store().read(), syntheticSecret);

  const unreadable = nativeModel();
  unreadable.failReadback = true;
  await assert.rejects(
    unreadable.store().write(syntheticSecret),
    storageUnavailable,
  );
  assert.equal(unreadable.values.get(unreadable.key), syntheticSecret);
});

test("an ambiguous native mutation is reported unavailable and later readback sees retained state", async () => {
  const model = nativeModel();
  model.failAfterEffect = true;
  await assert.rejects(
    model.store().write(syntheticSecret),
    storageUnavailable,
  );
  assert.equal(await model.store().read(), syntheticSecret);
  await assert.rejects(model.store().remove(), storageUnavailable);
  assert.equal(await model.store().read(), null);
});

test("separate synthetic namespaces never read or remove another stored credential", async () => {
  const model = nativeModel();
  const first = model.store();
  const second = new OperatingSystemLoginStore(
    `${model.service}-second`,
    "synthetic-login",
    async () => model.Entry,
    "win32",
  );
  await first.write(syntheticSecret);
  await second.write("synthetic-second-login");
  await first.remove();
  assert.equal(await second.read(), "synthetic-second-login");
  assert.equal(await first.read(), null);
});

test("Linux and unsupported systems never activate a fallback store", async () => {
  for (const platform of ["linux", "freebsd", "openbsd", "aix", "sunos"]) {
    let loads = 0;
    const store = new OperatingSystemLoginStore(
      `synthetic-${randomUUID()}`,
      "synthetic-login",
      async () => {
        loads += 1;
        throw new Error("native loader must not run");
      },
      platform,
    );
    await assert.rejects(store.read(), storageUnavailable);
    await assert.rejects(store.write(syntheticSecret), storageUnavailable);
    await assert.rejects(store.remove(), storageUnavailable);
    assert.equal(loads, 0);
  }
  // Constructing the production factory does not inspect its credential.
  assert.ok(
    createOperatingSystemLoginStore() instanceof OperatingSystemLoginStore,
  );
});

function storageUnavailable(error) {
  assert.ok(error instanceof HostedTestBlockedError);
  assert.equal(error.reason, "secure_storage_unavailable");
  assert.equal(error.message, "secure_storage_unavailable");
  assert.equal(error.cause, undefined);
  assert.equal(String(error.stack).includes(syntheticSecret), false);
  return true;
}

function nativeModel() {
  const service = `synthetic-${randomUUID()}`;
  const model = {
    service,
    key: `${service}:synthetic-login`,
    values: new Map(),
    operations: [],
    failure: null,
    discardWrite: false,
    discardRemoval: false,
    failReadback: false,
    failAfterEffect: false,
  };
  model.Entry = class {
    constructor(serviceName, user) {
      assert.ok(serviceName.startsWith("synthetic-"));
      assert.equal(user, "synthetic-login");
      this.key = `${serviceName}:${user}`;
    }
    getPassword() {
      model.operations.push("read");
      if (
        model.failure === "read" ||
        (model.failReadback && model.values.has(this.key))
      ) {
        throw new Error(`locked: ${syntheticSecret}`);
      }
      return model.values.has(this.key) ? model.values.get(this.key) : null;
    }
    setPassword(value) {
      model.operations.push("write");
      if (model.failure === "write")
        throw new Error(`locked: ${syntheticSecret}`);
      if (!model.discardWrite) model.values.set(this.key, value);
      if (model.failAfterEffect)
        throw new Error(`lost response: ${syntheticSecret}`);
    }
    deleteCredential() {
      model.operations.push("remove");
      if (model.failure === "remove")
        throw new Error(`locked: ${syntheticSecret}`);
      const hadCredential = model.values.has(this.key);
      if (!model.discardRemoval) model.values.delete(this.key);
      if (model.failAfterEffect)
        throw new Error(`lost response: ${syntheticSecret}`);
      return hadCredential;
    }
  };
  model.store = () =>
    new OperatingSystemLoginStore(
      service,
      "synthetic-login",
      async () => model.Entry,
      "darwin",
    );
  return model;
}
