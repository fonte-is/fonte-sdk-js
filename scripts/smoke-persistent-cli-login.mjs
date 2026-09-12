import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider } from "./login-proof/provider.mjs";
import { summarizeFailure } from "./login-proof/result.mjs";

// Usage: node scripts/smoke-persistent-cli-login.mjs /installed/@fonte-is/cli --store=native
// Model mode is deliberately separate and never claims native credential custody.
const [packageArgument, modeArgument = "--store=native"] =
  process.argv.slice(2);
const mode = modeArgument.replace(/^--store=/, "");
assert.ok(
  packageArgument && ["native", "model"].includes(mode),
  "installed CLI package path and --store=native|model required",
);
const packageRoot = resolve(packageArgument);
const manifest = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
assert.equal(
  manifest.name,
  "@fonte-is/cli",
  "an installed CLI package is required",
);
const cli = join(packageRoot, "dist/main.js");
await readFile(cli);
const support = join(dirname(fileURLToPath(import.meta.url)), "login-proof");
const cwd = await mkdtemp(join(tmpdir(), "fonte-persistent-login-proof-"));
const provider = await createProvider();
const service = `is.fonte.cli.proof.${randomUUID()}`;
const env = {
  ...process.env,
  FONTE_LOGIN_PROOF_ORIGIN: provider.origin,
  FONTE_LOGIN_PROOF_SERVICE: service,
  FONTE_LOGIN_PROOF_STORE: mode,
};
delete env.FONTE_CLI_CONFIG_URL;
delete env.FONTE_HUMAN_BEARER;
delete env.NODE_OPTIONS;
const invocations = [];
const outputs = [];
const failures = [];
let phase = "native_store_probe";
let cleanupNeeded = false;
let passed = false;
try {
  const probe = await invoke(["auth", "logout", "--json"]);
  if (mode === "native" && probe.code !== 0) {
    const receipt = JSON.parse(probe.stdout);
    assert.equal(receipt.state, "unavailable");
    assert.match(receipt.next_action, /secure credential storage/);
    console.log(
      JSON.stringify({
        ok: false,
        store: mode,
        nativeStoreAvailable: false,
        reason: "secure_storage_unavailable",
        browserOpenAttempts: provider.counts.browser,
      }),
    );
    process.exitCode = 2;
  } else {
    checkState(probe, "signed_out");
    cleanupNeeded = true;
    await acceptance();
    passed = true;
  }
} catch (error) {
  // Never print raw provider/child errors: diagnostic bodies may contain tokens.
  console.log(
    JSON.stringify({
      ok: false,
      store: mode,
      phase,
      counts: provider.counts,
      failures,
      reason:
        error?.message === "proof_child_timeout"
          ? "proof_child_timeout"
          : "proof_invariant_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  let cleaned = true;
  if (cleanupNeeded)
    cleaned = (await invoke(["auth", "logout", "--json"])).code === 0;
  if (mode === "model") cleaned &&= !provider.hasModelCredential();
  await provider.close();
  await rm(cwd, { recursive: true, force: true });
  if (!cleaned) {
    console.log(
      JSON.stringify({
        ok: false,
        store: mode,
        reason: "synthetic_store_cleanup_failed",
        service,
      }),
    );
    process.exitCode = 1;
  } else if (passed) {
    console.log(
      JSON.stringify({
        ok: true,
        store: mode,
        packageVersion: manifest.version,
        nativeStoreAvailable: mode === "native",
        separateInvocationsWithoutBrowser: 10,
        concurrentRotatingRefreshes: 4,
        browserOpenAttemptsBeforeLogout: 1,
        browserOpenAttemptsAfterRelogin: provider.counts.browser,
        refreshes: provider.counts.refresh,
        authorizedConsumers: provider.counts.consumer,
        logoutRequiresLogin: true,
        tokenLeakageChecks: ["stdout", "stderr", "argv", "task_files"],
        syntheticStoreRemoved: true,
      }),
    );
  }
}

async function acceptance() {
  phase = "initial_login";
  checkState(await invoke(["auth", "login", "--json"]), "signed_in");
  assert.equal(provider.counts.browser, 1);
  phase = "ten_separate_processes";
  for (let index = 0; index < 10; index++) {
    if (index % 2 === 0)
      checkState(await invoke(["auth", "status", "--json"]), "signed_in");
    else
      assert.equal(
        (
          await invoke([
            "auth",
            "exec",
            "--",
            process.execPath,
            join(support, "consumer.mjs"),
          ])
        ).code,
        0,
      );
  }
  assert.equal(provider.counts.browser, 1);
  assert.equal(provider.counts.refresh, 10);
  assert.equal(provider.counts.consumer, 5);
  phase = "concurrent_rotation";
  const results = await Promise.all(
    Array.from({ length: 4 }, () => invoke(["auth", "status", "--json"])),
  );
  results.forEach((result) => checkState(result, "signed_in"));
  assert.equal(provider.counts.refresh, 14);
  assert.equal(provider.counts.rejectedRefresh, 0);
  assert.equal(provider.counts.browser, 1);
  phase = "logout_and_relogin";
  checkState(await invoke(["auth", "logout", "--json"]), "signed_out");
  checkState(await invoke(["auth", "status", "--json"]), "signed_out", 3);
  assert.equal(provider.counts.refresh, 14);
  assert.equal(provider.counts.browser, 1);
  checkState(await invoke(["auth", "login", "--json"]), "signed_in");
  assert.equal(provider.counts.browser, 2);
  phase = "credential_leakage";
  assert.deepEqual(provider.errors, []);
  const surfaces = [
    ...outputs,
    JSON.stringify(invocations),
    JSON.stringify(provider.consumerArguments),
    ...(await files(cwd)),
  ];
  for (const token of provider.tokens) {
    assert.ok(
      surfaces.every((surface) => !surface.includes(token)),
      "credential bytes escaped into a checked surface",
    );
  }
}

function checkState(result, state, code = 0) {
  assert.equal(result.code, code, "CLI exit code");
  assert.equal(JSON.parse(result.stdout).state, state, "CLI auth state");
  // Node versions may warn about the external loader API. All stderr bytes
  // remain in the leakage audit, including these harness diagnostics.
}

function invoke(arguments_) {
  const args = [
    "--import",
    join(support, "instrumentation.mjs"),
    cli,
    ...arguments_,
  ];
  invocations.push(args);
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("proof_child_timeout"));
    }, 65_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      outputs.push(stdout, stderr);
      if (code !== 0) failures.push(summarizeFailure(code, stdout));
      resolveResult({ code, stdout, stderr });
    });
  });
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(...(await files(path)));
    else if (entry.isFile()) contents.push(await readFile(path, "utf8"));
  }
  return contents;
}
