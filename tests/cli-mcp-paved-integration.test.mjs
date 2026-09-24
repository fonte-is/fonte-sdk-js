import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("shared fonte host reuses selected workspace and keeps CSV supplier private", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-paved-host-"));
  const csvPath = path.join(directory, "audience.csv");
  const proofPath = path.join(directory, "proof.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(csvPath, "email\nmember@example.test\n", "utf8");

  const host = startMcp({ csvPath, proofPath });
  t.after(() => host.close());
  const initialized = await host.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fonte-paved-integration", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "fonte");
  assert.match(initialized.result.instructions, /same input/u);
  assert.match(initialized.result.instructions, /no human input/u);
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
  const prepareTool = tools.find(({ name }) => name === "fonte_prepare_broadcast");
  assert.ok(prepareTool.inputSchema.properties.audience_file);

  const response = await host.request("tools/call", {
    name: "fonte_prepare_broadcast",
    arguments: {
      draft_id: "00000000-0000-4000-8000-000000000751",
      audience_file: csvPath,
    },
  });
  assert.equal(response.error, undefined);
  const prepared = response.result.structuredContent;
  assert.equal(prepared.status, "preparing");
  assert.deepEqual(prepared.missing, []);
  assert.deepEqual(prepared.choices, []);
  assert.equal(prepared.send_input, null);
  assert.doesNotMatch(
    JSON.stringify(prepared),
    /one_time_set_id|recipient_set|clientRequestKey|recipient-sets/iu,
  );

  await host.close();
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  assert.ok(proof.selectedWorkspaceReads > 0);
  assert.equal(proof.draftReadWorkspace, "northstar");
  assert.equal(proof.supplierProviderCalls, 1);
  assert.equal(proof.supplierCreateCalls, 1);
  assert.ok(proof.supplierReadCalls >= 4);
  assert.equal(proof.sendCalls, 0);
});

function startMcp({ csvPath, proofPath }) {
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cli-mcp-paved-composition-stdio.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAVED_CSV_FILE: csvPath,
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
