import assert from "node:assert/strict";
import { mkdtemp, chmod, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  runTrustedMcpClient,
  startTrustedMcpHost,
} from "../packages/cli/dist/trusted-mcp-ipc.js";

test("five local clients share a private MCP socket and survive host restart", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-trusted-mcp-"));
  const socketPath = path.join(directory, "mcp.sock");
  let host;
  let clientCount = 0;
  t.after(async () => {
    await host?.close();
    await rm(directory, { recursive: true, force: true });
  });

  const start = () =>
    startTrustedMcpHost({
      socketPath,
      handleClient(client) {
        clientCount += 1;
        client.on("data", (chunk) => client.write(chunk));
        client.once("end", () => client.end());
      },
    });
  host = await start();

  const directoryStat = await lstat(directory);
  const socketStat = await lstat(socketPath);
  assert.equal(directoryStat.mode & 0o777, 0o700);
  assert.equal(socketStat.mode & 0o777, 0o600);
  assert.equal(directoryStat.uid, process.getuid());
  assert.equal(socketStat.uid, process.getuid());

  const payloads = Array.from({ length: 5 }, (_, index) =>
    Buffer.from(`client-${index + 1}\n`),
  );
  const first = await Promise.all(
    payloads.map((payload) => runClient(socketPath, payload)),
  );
  assert.deepEqual(first, payloads);
  assert.equal(clientCount, 5);

  await host.close();
  host = undefined;
  await assert.rejects(
    runClient(socketPath, Buffer.from("offline\n"), 250),
    /local_mcp_host_unavailable/u,
  );

  host = await start();
  assert.deepEqual(
    await runClient(socketPath, Buffer.from("after-restart\n")),
    Buffer.from("after-restart\n"),
  );
});

test("client refuses an endpoint with an unsafe directory permission", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-trusted-mcp-"));
  const socketPath = path.join(directory, "mcp.sock");
  const host = await startTrustedMcpHost({
    socketPath,
    handleClient(client) {
      client.on("data", (chunk) => client.write(chunk));
      client.once("end", () => client.end());
    },
  });
  t.after(async () => {
    await chmod(directory, 0o700);
    await host.close();
    await rm(directory, { recursive: true, force: true });
  });

  await chmod(directory, 0o755);
  await assert.rejects(
    runClient(socketPath, Buffer.from("denied\n")),
    /local_mcp_host_unavailable/u,
  );
  await chmod(directory, 0o700);
});

async function runClient(socketPath, payload, timeoutMs = 3000) {
  const stdin = new PassThrough();
  const output = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output.push(Buffer.from(chunk));
      callback();
    },
  });
  const result = runTrustedMcpClient({
    socketPath,
    stdin,
    stdout,
    timeoutMs,
  });
  stdin.end(payload);
  await result;
  return Buffer.concat(output);
}
