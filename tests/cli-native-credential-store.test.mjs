import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CLIENT_AUTH_STORE_NATIVE_ABI,
  loadNativeClientAuthStore,
} from "../packages/cli/dist/credential-store/native-loader.js";

const validModule = {
  ABI_NAME: CLIENT_AUTH_STORE_NATIVE_ABI,
  async read() {
    return null;
  },
  async replace() {},
};

test("the loader accepts exactly the five reviewed package cells", async () => {
  const cells = [
    [
      "darwin",
      "arm64",
      undefined,
      "native/darwin-arm64/fonte_client_auth_store.node",
    ],
    [
      "darwin",
      "x64",
      undefined,
      "native/darwin-x64/fonte_client_auth_store.node",
    ],
    [
      "win32",
      "x64",
      undefined,
      "native/win32-x64/fonte_client_auth_store.node",
    ],
    [
      "linux",
      "x64",
      "glibc",
      "native/linux-x64-gnu/fonte_client_auth_store.node",
    ],
    [
      "linux",
      "arm64",
      "glibc",
      "native/linux-arm64-gnu/fonte_client_auth_store.node",
    ],
  ];
  for (const [platform, arch, libc, suffix] of cells) {
    const loaded = [];
    assert.equal(
      await loadNativeClientAuthStore({ platform, arch, libc }, (path) => {
        loaded.push(path);
        return validModule;
      }),
      validModule,
    );
    assert.equal(loaded.length, 1);
    assert.ok(loaded[0].endsWith(suffix), loaded[0]);
  }
});

test("unsupported, musl, Windows ARM, and missing binaries have no fallback", async () => {
  const blocked = [
    ["linux", "x64", "other"],
    ["linux", "arm", "glibc"],
    ["win32", "arm64", undefined],
    ["freebsd", "x64", undefined],
  ];
  for (const [platform, arch, libc] of blocked) {
    let loads = 0;
    await assert.rejects(
      loadNativeClientAuthStore({ platform, arch, libc }, () => {
        loads += 1;
        return validModule;
      }),
      /native_store_unavailable/,
    );
    assert.equal(loads, 0);
  }

  await assert.rejects(
    loadNativeClientAuthStore({ platform: "darwin", arch: "arm64" }, () => {
      throw new Error("missing");
    }),
    /missing/,
  );
  await assert.rejects(
    loadNativeClientAuthStore({ platform: "darwin", arch: "arm64" }, () => ({
      ...validModule,
      ABI_NAME: "wrong",
    })),
    /native_store_invalid/,
  );
});

test("local-only CLI and SDK import do not load a native binary", async () => {
  const help = spawnSync(
    process.execPath,
    ["packages/cli/dist/main.js", "--help"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);

  const coreImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import('./packages/core/dist/index.js')",
    ],
    { encoding: "utf8" },
  );
  assert.equal(coreImport.status, 0, coreImport.stderr);
});

test("the new adapter and native sources never name the legacy slot", async () => {
  const files = [
    "packages/cli/src/secure-login-store.ts",
    "packages/cli/src/credential-store/native-loader.ts",
    "packages/cli/native/client-auth-store/src/lib.rs",
    "packages/cli/native/client-auth-store/src/platform/darwin.rs",
    "packages/cli/native/client-auth-store/src/platform/linux.rs",
    "packages/cli/native/client-auth-store/src/platform/windows.rs",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(source.includes('"is.fonte.cli"'), false, file);
    assert.equal(source.includes("login-v1"), false, file);
  }
});

test("native sources retain the reviewed APIs, pins, and no-prompt patch", async () => {
  const root = "packages/cli/native/client-auth-store";
  const [manifest, lock, darwin, windows, linux, patch, apache, mit] =
    await Promise.all([
      readFile(`${root}/Cargo.toml`, "utf8"),
      readFile(`${root}/Cargo.lock`, "utf8"),
      readFile(`${root}/src/platform/darwin.rs`, "utf8"),
      readFile(`${root}/src/platform/windows.rs`, "utf8"),
      readFile(`${root}/src/platform/linux.rs`, "utf8"),
      readFile(
        `${root}/vendor/secret-service-5.1.0/FONTE-NO-PROMPT-PATCH.md`,
        "utf8",
      ),
      readFile(`${root}/vendor/secret-service-5.1.0/LICENSE-APACHE`, "utf8"),
      readFile(`${root}/vendor/secret-service-5.1.0/LICENSE-MIT`, "utf8"),
    ]);

  for (const pin of [
    'napi = { version = "=3.12.7"',
    'napi-derive = "=3.6.3"',
    'napi-build = "=2.4.4"',
    'security-framework-sys = "=2.17.0"',
    'core-foundation-sys = "=0.8.7"',
    'windows-sys = { version = "=0.61.2"',
    'secret-service = { version = "=5.1.0"',
    'zbus = { version = "=5.19.0"',
  ]) {
    assert.ok(manifest.includes(pin), pin);
  }
  for (const locked of [
    ["napi", "3.12.7"],
    ["napi-derive", "3.6.3"],
    ["napi-build", "2.4.4"],
    ["secret-service", "5.1.0"],
    ["zbus", "5.19.0"],
  ]) {
    assert.match(
      lock,
      new RegExp(`name = "${locked[0]}"\\nversion = "${locked[1]}"`),
    );
  }
  for (const api of [
    "SecItemCopyMatching",
    "SecItemUpdate",
    "SecItemAdd",
    "kSecUseAuthenticationUIFail",
    "SecKeychainCopyDefault",
  ]) {
    assert.ok(darwin.includes(api), api);
  }
  for (const api of [
    "CredReadW",
    "CredWriteW",
    "CredFree",
    "CRED_PERSIST_LOCAL_MACHINE",
    "Fonte/is.fonte.client-auth/customer-session-v1",
  ]) {
    assert.ok(windows.includes(api), api);
  }
  for (const boundary of [
    "get_name_owner",
    "get_connection_unix_user",
    "EncryptionType::Dh",
    "create_item_no_prompt",
    '("schema", "fonte.client_session.v1")',
  ]) {
    assert.ok(linux.includes(boundary), boundary);
  }
  assert.match(
    patch,
    /9a62d7f86047af0077255a29494136b9aaaf697c76ff70b8e49cded4e2623c14/,
  );
  assert.ok(apache.length > 1_000);
  assert.ok(mit.length > 500);
});
