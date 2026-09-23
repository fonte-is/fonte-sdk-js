import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalWorkspaceContextStore } from "../packages/cli/dist/local-workspace-context.js";

test("workspace context is private local config and reads back the exact choice", async () => {
  const directory = await mkdtemp(
    path.join(temporaryRoot(), "fonte-workspace-context-"),
  );
  try {
    const store = new LocalWorkspaceContextStore({ directory });
    assert.equal(await store.read(), null);

    await store.select("demo-store");

    assert.equal(await store.read(), "demo-store");
    const entry = await stat(path.join(directory, "workspace-context.v1.json"));
    if (process.platform !== "win32") assert.equal(entry.mode & 0o777, 0o600);
    const source = await readFile(
      path.join(directory, "workspace-context.v1.json"),
      "utf8",
    );
    assert.match(source, /"schema":"fonte\.local_workspace_context\.v1"/);
    assert.doesNotMatch(source, /token|secret|customer/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace context rejects malformed workspace identifiers", async () => {
  const directory = await mkdtemp(
    path.join(temporaryRoot(), "fonte-workspace-context-"),
  );
  try {
    const store = new LocalWorkspaceContextStore({ directory });
    await assert.rejects(
      store.select("../source"),
      /local_workspace_context_invalid/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function temporaryRoot() {
  return process.platform === "darwin" ? "/private/tmp" : tmpdir();
}
