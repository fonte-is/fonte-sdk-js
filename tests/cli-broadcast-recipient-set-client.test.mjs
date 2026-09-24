import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCoreRequester } from "../packages/cli/dist/operator-core-request.js";
import {
  BROADCAST_RECIPIENT_SET_MAX_BYTES,
  createBroadcastRecipientSetClient,
} from "../packages/cli/dist/operator-broadcast-recipient-set-client.js";
import { readBroadcastLocalFile } from "../packages/cli/dist/operator-broadcast-html-file.js";

const workspace = "demo-workspace";
const draftId = "11111111-1111-4111-8111-111111111111";
const setId = "22222222-2222-4222-8222-222222222222";
const clientRequestKey = "broadcast-include-fixture-01";
const batchId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-09-24T00:00:00.000Z";

test("creates from exact local bytes, reads the exact set, and preserves lifecycle state", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fonte-recipient-set-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const csvFilePath = path.join(directory, "audience.csv");
  const records = Array.from({ length: 2_048 }, (_, index) => {
    const email = `recipient-${String(index + 1).padStart(4, "0")}@example.test`;
    return index === 511
      ? `${email},"line one\nline two"`
      : `${email},"segment, ${index + 1}"`;
  });
  const bytes = Buffer.from(`\ufeff"email",segment\r\n${records.join("\r\n")}\r\n`);
  await writeFile(csvFilePath, bytes);

  let currentState = "pending";
  const calls = [];
  const requester = createCoreRequester({
    coreApiBaseUrl: "https://core.example.test",
    bearer: "synthetic-session-token",
    maxResponseBytes: 65_536,
    fetch: async (url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer synthetic-session-token");
      const method = init.method ?? "GET";
      const requestBody = typeof init.body === "string"
        ? JSON.parse(init.body)
        : null;
      calls.push({
        method,
        path: new URL(url).pathname + new URL(url).search,
        body: requestBody,
        authorization: headers.get("authorization"),
      });
      return new Response(JSON.stringify(envelope(currentState)), {
        status: method === "POST" ? 202 : 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const client = createBroadcastRecipientSetClient(requester, readBroadcastLocalFile);
  const input = {
    workspace,
    draftId,
    setId,
    clientRequestKey,
    expectedDraftVersion: 19,
    csvFilePath,
  };

  const created = await client.createBroadcastRecipientSet(input);
  assert.equal(created.recipient_set.status, "pending");
  assert.equal(created.recipient_set.operation_status, "pending");
  assert.equal(created.source.file_name, "audience.csv");
  assert.equal(created.source.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(created.source.byte_length, bytes.byteLength);
  assert.equal(created.source.row_count, 2_048);

  const post = calls[0];
  assert.deepEqual(post, {
    method: "POST",
    path: `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}/recipient-sets?environment=production`,
    body: {
      setId,
      clientRequestKey,
      expectedDraftVersion: 19,
      usage: "include",
      csvText: bytes.toString("utf8"),
      sourceFileName: "audience.csv",
    },
    authorization: "Bearer synthetic-session-token",
  });
  assert.deepEqual(calls[1], {
    method: "GET",
    path: `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}/recipient-sets/${setId}?environment=production`,
    body: null,
    authorization: "Bearer synthetic-session-token",
  });

  currentState = "completed";
  assert.equal(
    (await client.readBroadcastRecipientSet({ workspace, draftId, setId })).status,
    "completed",
  );
  currentState = "unavailable";
  assert.equal(
    (await client.readBroadcastRecipientSet({ workspace, draftId, setId })).status,
    "unavailable",
  );

  const replay = await client.createBroadcastRecipientSet(input);
  assert.equal(replay.recipient_set.status, "unavailable");
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.setId, setId);
  assert.equal(posts[1].body.clientRequestKey, clientRequestKey);
  assert.equal(posts[1].body.csvText, posts[0].body.csvText);
  assert.ok(calls.every((call) => call.authorization === "Bearer synthetic-session-token"));
  assert.ok(calls.every((call) => call.path.includes("/recipient-sets")));
  assert.equal(calls.length, 6);

  const output = JSON.stringify({ created, replay });
  assert.equal(output.includes("recipient-0001@example.test"), false);
  assert.equal(output.includes("recipient-2048@example.test"), false);
  assert.equal(output.includes('"rows"'), false);
  assert.equal(output.includes('"recipients"'), false);
});

test("rejects non-absolute, non-regular, oversized, invalid UTF-8, and invalid-header CSV before POST", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fonte-recipient-set-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const sent = [];
  const client = createBroadcastRecipientSetClient(
    async (...args) => {
      sent.push(args);
      throw new Error("unexpected Core request");
    },
    readBroadcastLocalFile,
  );
  const input = (csvFilePath) => ({
    workspace,
    draftId,
    setId,
    clientRequestKey,
    expectedDraftVersion: 19,
    csvFilePath,
  });

  await assert.rejects(
    client.createBroadcastRecipientSet(input("relative.csv")),
    (error) => error.reason === "broadcast_source_path_not_absolute",
  );

  const invalidHeaderPath = path.join(directory, "invalid-header.csv");
  await writeFile(invalidHeaderPath, "address\nreader@example.test\n");
  await assert.rejects(
    client.createBroadcastRecipientSet(input(invalidHeaderPath)),
    (error) => error.reason === "csv_email_header_invalid",
  );

  const invalidUtf8Path = path.join(directory, "invalid-utf8.csv");
  await writeFile(invalidUtf8Path, Buffer.concat([
    Buffer.from("email\n"),
    Buffer.from([0xc3, 0x28]),
  ]));
  await assert.rejects(
    client.createBroadcastRecipientSet(input(invalidUtf8Path)),
    (error) => error.reason === "csv_file_encoding_invalid",
  );

  const directoryPath = path.join(directory, "directory.csv");
  await mkdir(directoryPath);
  await assert.rejects(
    client.createBroadcastRecipientSet(input(directoryPath)),
    (error) => error.reason === "broadcast_source_not_regular_file",
  );

  const regularPath = path.join(directory, "regular.csv");
  await writeFile(regularPath, "email\nreader@example.test\n");
  const linkPath = path.join(directory, "link.csv");
  await symlink(regularPath, linkPath);
  await assert.rejects(
    client.createBroadcastRecipientSet(input(linkPath)),
    (error) => error.reason === "broadcast_source_not_regular_file",
  );

  const oversizedPath = path.join(directory, "oversized.csv");
  await writeFile(oversizedPath, Buffer.alloc(BROADCAST_RECIPIENT_SET_MAX_BYTES + 1, 0x61));
  await assert.rejects(
    client.createBroadcastRecipientSet(input(oversizedPath)),
    (error) => error.reason === "broadcast_source_file_too_large",
  );

  assert.equal(sent.length, 0);
});

function envelope(status) {
  return {
    tenantId: "synthetic-tenant",
    environment: "production",
    result: {
      oneTimeSetId: setId,
      draftId,
      status,
      operationStatus: status,
      contactImportBatchId: status === "pending" ? null : batchId,
      createdAt,
      populationEffect: "broadcast_only_not_everyone",
    },
  };
}
