import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { scope, reviewRequest, ready } from "./fixtures/broadcast-bg1.mjs";

test("shared fonte host prepares the explicit BG review with zero legacy supplier or grant calls", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-paved-host-"));
  const csvPath = path.join(directory, "audience.csv");
  const proofPath = path.join(directory, "proof.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(csvPath, "email\nmember@example.test\n", "utf8");

  const host = startMcp({
    requestDirectory: path.join(directory, "requests"),
    proofPath,
  });
  t.after(() => host.close());
  const initialized = await host.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fonte-paved-integration", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "fonte");
  assert.match(initialized.result.instructions, /exact draft version/u);
  assert.match(initialized.result.instructions, /explicit user approval/u);
  host.notify("notifications/initialized", {});

  const listed = await host.request("tools/list", {});
  const tools = listed.result.tools;
  const names = tools.map(({ name }) => name);
  assert.ok(names.includes("fonte_prepare_broadcast"));
  assert.ok(names.includes("fonte_send_broadcast"));
  assert.equal(
    names.some((name) => /recipient.?set|one.?time.?set/iu.test(name)),
    false,
  );
  const prepareTool = tools.find(
    ({ name }) => name === "fonte_prepare_broadcast",
  );
  assert.equal(prepareTool.inputSchema.properties.audience_file, undefined);
  for (const field of ["workspace", "environment", "draftId", "request"])
    assert.ok(prepareTool.inputSchema.properties[field]);

  const response = await host.request("tools/call", {
    name: "fonte_prepare_broadcast",
    arguments: { ...scope, request: reviewRequest },
  });
  assert.equal(response.error, undefined);
  const prepared = response.result.structuredContent;
  assert.deepEqual(prepared.operation, ready);
  assert.equal(prepared.operation.executionAuthorized, false);
  assert.doesNotMatch(
    JSON.stringify(prepared),
    /one_time_set_id|recipient_set|clientRequestKey|recipient-sets/iu,
  );
  const obsolete = await host.request("tools/call", {
    name: "fonte_prepare_broadcast",
    arguments: { ...scope, request: reviewRequest, audience_file: csvPath },
  });
  assert.ok(obsolete.error || obsolete.result.isError);

  await host.close();
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  assert.equal(proof.catalogReads, 1);
  assert.equal(proof.bgReviewPosts, 1);
  assert.equal(proof.draftReadWorkspace, null);
  for (const field of [
    "selectedWorkspaceReads",
    "supplierProviderCalls",
    "supplierCreateCalls",
    "supplierReadCalls",
    "sendCalls",
    "legacyCanonicalProviderCalls",
    "legacyPrepareCalls",
    "legacySendCalls",
    "legacyOtherProviderCalls",
    "quoteConfirmCalls",
  ]) {
    assert.equal(proof[field], 0, field);
  }
});

function startMcp({ requestDirectory, proofPath }) {
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cli-mcp-paved-composition-stdio.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAVED_REQUEST_DIRECTORY: requestDirectory,
        PAVED_PROOF_FILE: proofPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (typeof message.id !== "number") return;
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    get stderr() {
      return stderr;
    },
    request(method, params) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timed out waiting for ${method}`));
        }, 30_000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    },
    notify(method, params) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    async close() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
      lines.close();
      assert.equal(stderr, "");
    },
  };
}
