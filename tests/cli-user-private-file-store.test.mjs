import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { createServer } from "node:net";
import test from "node:test";

import { createClientAuthSession } from "../packages/cli/dist/persistent-login.js";
import { LoopbackLoginLock } from "../packages/cli/dist/login-lock.js";
import { ClientAuthStoreSelector } from "../packages/cli/dist/credential-store/store-selection.js";
import {
  UserPrivateFileAuthStore,
  UserPrivateStoreFailure,
  USER_PRIVATE_SESSION_LIMIT_BYTES,
  sessionFilePath,
  userDataDirectory,
} from "../packages/cli/dist/credential-store/user-private-file-store.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";

const binding = {
  issuer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  scopes: ["email"],
  coreApiTarget: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
};
const readyRecord = {
  schema: "fonte.client_session.v1",
  state: "ready",
  binding,
  loginId: "10000000-0000-4000-8000-000000000001",
  subject: "synthetic-subject",
  refreshToken: "synthetic-refresh-0",
  epoch: "10000000-0000-4000-8000-000000000002",
  generation: 2,
};

test("per-user application data paths are selected by OS convention", () => {
  assert.equal(
    userDataDirectory({
      platform: "darwin",
      home: "/Users/demo",
      env: {},
    }),
    "/Users/demo/Library/Application Support/Fonte/CLI",
  );
  assert.equal(
    userDataDirectory({
      platform: "linux",
      home: "/home/demo",
      env: { XDG_DATA_HOME: "/private/data" },
    }),
    "/private/data/fonte/cli",
  );
});

test("file records use exact private modes, canonical bytes, readback, and Fonte-only cleanup", async () => {
  const directory = await privateTempDirectory();
  const store = new UserPrivateFileAuthStore({ directory });
  assert.equal(await store.read({ allowInteraction: false }), null);
  await store.replace(readyRecord, { allowInteraction: false });
  const dirInfo = await lstat(directory);
  const fileInfo = await lstat(sessionFilePath(directory));
  assert.equal(dirInfo.mode & 0o777, 0o700);
  assert.equal(fileInfo.mode & 0o777, 0o600);
  assert.deepEqual(await store.read({ allowInteraction: false }), readyRecord);

  const unrelated = join(directory, "other-application-data");
  await writeFile(unrelated, "keep");
  await store.clearSession();
  await assert.rejects(readFile(sessionFilePath(directory)));
  assert.equal(await readFile(unrelated, "utf8"), "keep");
});

test("oversize records are rejected before replacing existing custody", async () => {
  const directory = await privateTempDirectory();
  const store = new UserPrivateFileAuthStore({ directory });
  await store.replace(readyRecord, { allowInteraction: false });
  const previous = await readFile(sessionFilePath(directory));
  await assert.rejects(
    store.replace(
      {
        ...readyRecord,
        refreshToken: "x".repeat(USER_PRIVATE_SESSION_LIMIT_BYTES),
      },
      { allowInteraction: false },
    ),
    (error) =>
      error instanceof UserPrivateStoreFailure &&
      error.kind === "misconfigured",
  );
  assert.deepEqual(await readFile(sessionFilePath(directory)), previous);
});

test("unsafe modes, ownership, and symlink substitution fail closed", async (context) => {
  if (process.platform === "win32")
    return context.skip("POSIX mode and uid checks");
  const directory = await privateTempDirectory();
  const store = new UserPrivateFileAuthStore({ directory });
  await store.replace(readyRecord, { allowInteraction: false });
  const session = sessionFilePath(directory);

  await chmod(session, 0o644);
  await assert.rejects(
    store.read({ allowInteraction: false }),
    (error) =>
      error instanceof UserPrivateStoreFailure &&
      error.kind === "misconfigured",
  );
  await chmod(session, 0o600);

  const wrongOwner = new UserPrivateFileAuthStore({
    directory,
    expectedUid: (process.getuid?.() ?? 0) + 1,
  });
  await assert.rejects(
    wrongOwner.read({ allowInteraction: false }),
    (error) =>
      error instanceof UserPrivateStoreFailure &&
      error.kind === "misconfigured",
  );

  const outside = join(await privateTempDirectory(), "outside.json");
  await writeFile(outside, "preserve-this");
  await chmod(session, 0o600);
  const { unlink } = await import("node:fs/promises");
  await unlink(session);
  await symlink(outside, session);
  await assert.rejects(
    store.read({ allowInteraction: false }),
    (error) =>
      error instanceof UserPrivateStoreFailure &&
      error.kind === "misconfigured",
  );
  await assert.rejects(
    store.replace(readyRecord, { allowInteraction: false }),
    (error) =>
      error instanceof UserPrivateStoreFailure &&
      error.kind === "misconfigured",
  );
  assert.equal(await readFile(outside, "utf8"), "preserve-this");
});

test("selector pins the explicit file choice across new runtimes and never retries native storage", async () => {
  const directory = await privateTempDirectory();
  let nativeReads = 0;
  const unavailableNative = {
    read: async () => {
      nativeReads += 1;
      throw new HostedTestBlockedError("secure_storage_unavailable");
    },
    replace: async () => {
      throw new HostedTestBlockedError("secure_storage_unavailable");
    },
  };
  const first = new ClientAuthStoreSelector({
    directory,
    nativeStore: unavailableNative,
  });
  await assert.rejects(
    first.read({ allowInteraction: false }),
    (error) =>
      error instanceof HostedTestBlockedError &&
      error.reason === "secure_storage_unavailable",
  );
  assert.deepEqual(await first.storageInfo(), {
    backend: "native_secure_store",
    status: "unavailable",
  });
  await first.selectBackend("file");
  await first.replace(readyRecord, { allowInteraction: false });
  const restarted = new ClientAuthStoreSelector({
    directory,
    nativeStore: unavailableNative,
  });
  assert.deepEqual(
    await restarted.read({ allowInteraction: false }),
    readyRecord,
  );
  assert.deepEqual(await restarted.storageInfo(), {
    backend: "user_private_file",
    status: "available",
  });
  await restarted.clearSession();
  assert.equal(nativeReads, 1);
  const choice = JSON.parse(
    await readFile(join(directory, "storage-choice.v1.json"), "utf8"),
  );
  assert.deepEqual(choice, {
    backend: "file",
    schema: "fonte.auth_storage_choice.v1",
  });
  assert.equal(JSON.stringify(choice).includes("synthetic-refresh-0"), false);
});

test("multiple session instances serialize refresh updates through the selected file store", async () => {
  const directory = await privateTempDirectory();
  const store = new ClientAuthStoreSelector({
    directory,
    nativeStore: {
      read: async () => {
        throw new HostedTestBlockedError("secure_storage_unavailable");
      },
      replace: async () => {
        throw new HostedTestBlockedError("secure_storage_unavailable");
      },
    },
  });
  await store.selectBackend("file");
  const port = await unusedPort();
  const lock = new LoopbackLoginLock(port, 30_000, 5);
  let ids = 2;
  let renewals = 0;
  const newSession = () =>
    createClientAuthSession({
      store,
      withLock: (operation, signal) => lock.run(operation, signal),
      now: () => 1_000_000,
      randomUUID: () =>
        `10000000-0000-4000-8000-${String(ids++).padStart(12, "0")}`,
      oauth: {
        prepareExplicitLogin: async () => ({
          complete: async (commit) => {
            const grant = {
              accessToken: "synthetic-login-access",
              refreshToken: "synthetic-refresh-0",
              subject: "synthetic-subject",
              scopes: ["email"],
              expiresAt: 1_000_100,
            };
            await commit(grant);
            return grant;
          },
        }),
        renew: async (targetBinding, refreshToken, subject, options) => {
          await options.beforeExchange();
          assert.equal(refreshToken, `synthetic-refresh-${renewals}`);
          const next = ++renewals;
          return {
            tag: "success",
            exchangeSubmitted: true,
            accessToken: `synthetic-refreshed-access-${next}`,
            refreshToken: `synthetic-refresh-${next}`,
            subject,
            scopes: targetBinding.scopes,
            expiresAt: 1_000_100,
          };
        },
      },
    });

  await newSession().login(binding, {
    switchAccount: false,
    interactive: true,
  });
  const handles = await Promise.all(
    Array.from({ length: 8 }, () => newSession().authorize(binding)),
  );
  const current = await store.read({ allowInteraction: false });
  assert.equal(renewals, 8);
  assert.equal(current.state, "ready");
  assert.equal(current.refreshToken, "synthetic-refresh-8");
  assert.equal(current.generation, 17);
  assert.equal(new Set(handles.map(({ accessToken }) => accessToken)).size, 8);
  assert.equal(
    (await readFile(sessionFilePath(directory), "utf8")).includes(
      "synthetic-refreshed-access",
    ),
    false,
  );
});

async function privateTempDirectory() {
  return mkdtemp(join(await realpath(tmpdir()), "fonte-cli-private-store-"));
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing ephemeral port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
