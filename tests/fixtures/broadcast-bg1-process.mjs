import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { coreOrigin, scope, workspaceId, json } from "./broadcast-bg1.mjs";

// Fresh processes use the built/packed product modules. Transport alone is replaced;
// there is no alternate command authority, provider call, or fabricated Core DB query.
const dist = process.env.FONTE_BG_DIST_ROOT ?? resolve("packages/cli/dist");
const [
  { runProgram },
  { createBroadcastFileStore },
  { createBroadcastBgToolHandlers },
] = await Promise.all([
  import(pathToFileURL(resolve(dist, "program.js"))),
  import(pathToFileURL(resolve(dist, "broadcast-file-store.js"))),
  import(pathToFileURL(resolve(dist, "mcp-broadcast-bg-tools.js"))),
]);
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
let state = await readFile(input.serverState, "utf8")
  .then(JSON.parse)
  .catch(() => ({ effects: [] }));
const store = createBroadcastFileStore(input.storeDirectory);
const calls = [];
const ceilings = new Map();
const originalTimeout = AbortSignal.timeout;
AbortSignal.timeout = (milliseconds) => {
  const signal = originalTimeout(milliseconds);
  ceilings.set(signal, milliseconds);
  return signal;
};
const dependencies = {
  coreApiBaseUrl: coreOrigin,
  bearer: "synthetic-bg1-bearer",
  store,
  resolveWorkspaceId: async (workspace) => {
    assert.equal(workspace, scope.workspace);
    return workspaceId;
  },
  sleep: async () => {},
  fetch: async (url, init) => {
    assert.equal(new URL(url).origin, coreOrigin);
    assert.equal(init.redirect, "error");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({
      url,
      method: init.method,
      body,
      timeoutMs: ceilings.get(init.signal),
    });
    if (body) {
      const durable = await store.read(body.requestId);
      assert.deepEqual(
        durable.request,
        body,
        "immutable input must be durable before POST",
      );
      assert.equal(durable.workspaceId, workspaceId);
      if (input.loss === "before")
        throw new Error("synthetic response loss before commit");
      const previous = state.effects.find(
        (entry) => entry.requestId === body.requestId,
      );
      if (previous) assert.deepEqual(previous.body, body);
      else {
        state.effects.push({ requestId: body.requestId, body });
        await writeFile(input.serverState, JSON.stringify(state));
      }
      if (input.loss === "after")
        throw new Error("synthetic response loss after commit");
    }
    return json(input.receipt);
  },
};
let result;
if (input.mode === "mcp")
  result = await createBroadcastBgToolHandlers(async () => dependencies)[
    input.tool
  ](input.payload);
else {
  const program = await runProgram(input.args, {
    cwd: resolve("."),
    randomUUID: () => {
      throw new Error("BG must not create a new request key");
    },
    runner: {
      run: async () => {
        throw new Error("BG must not invoke an unrelated runner");
      },
    },
    broadcast: async () => dependencies,
  });
  assert.equal(program.stderr, "");
  result = JSON.parse(program.stdout);
}
process.stdout.write(JSON.stringify({ result, calls, state }));
