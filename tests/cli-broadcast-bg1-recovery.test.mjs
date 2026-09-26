import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { approvedBroadcastSendRequest } from "../packages/cli/dist/broadcast-approval.js";
import { renderBroadcastCommand } from "../packages/cli/dist/broadcast-command.js";
import {
  scope,
  review,
  ready,
  zeroReady,
  processing,
  executable,
  requestId,
  operationId,
  reviewRequest,
  sendRequest,
  saved,
} from "./fixtures/broadcast-bg1.mjs";
const secondId = "00000000-0000-4000-8000-000000008073";
const thirdId = "00000000-0000-4000-8000-000000008074";
const fourthId = "00000000-0000-4000-8000-000000008075";
const execute = promisify(execFile);

for (const mode of ["cli", "mcp"])
  for (const loss of ["before", "after"]) {
    test(`fresh ${mode} process recovers exact input after response loss ${loss} simulated commit`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "fon813-process-"));
      try {
        const input = {
          mode,
          storeDirectory: join(directory, "inputs"),
          serverState: join(directory, "server.json"),
          receipt: processing,
        };
        const sent = await child({
          ...input,
          loss,
          ...sendInvocation(mode, saved()),
        });
        assert.equal(sent.result.core_effect, "unknown");
        assert.equal(sent.result.operation, null);
        const recovered = await child({
          ...input,
          ...recoverInvocation(mode, requestId),
        });
        assert.equal(recovered.result.operation.operationId, operationId);
        assert.equal(recovered.result.outcome, "pending");
        assert.deepEqual(recovered.calls[0].body, sendRequest);
        assert.equal(recovered.state.effects.length, 1);
        assert.equal(recovered.calls[0].timeoutMs, 60_000);
        const changed = await child({
          ...input,
          ...sendInvocation(
            mode,
            saved({ ...sendRequest, expectedDraftVersion: 2 }),
          ),
        });
        assert.equal(changed.result.reason, "broadcast_request_conflict");
        assert.equal(changed.calls.length, 0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

for (const mode of ["cli", "mcp"])
  test(`fresh ${mode} review and explicit CAS re-approval retire the superseded saved request`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "fon813-resume-"));
    try {
      const input = {
        mode,
        storeDirectory: join(directory, "inputs"),
        serverState: join(directory, "server.json"),
      };
      const reviewed = await child({
        ...input,
        receipt: ready,
        ...reviewInvocation(mode),
      });
      assert.equal(reviewed.result.operation.executionAuthorized, false);
      const approved = approvedBroadcastSendRequest(ready, secondId);
      await child({
        ...input,
        receipt: {
          ...processing,
          outcome: "action_required",
          blocker: { code: "commercial_action_required" },
        },
        ...sendInvocation(mode, saved(approved)),
      });
      // A distinct explicitly obtained review retains its producer commitments and replaces only opaque review identity.
      const newReview = {
        ...ready,
        reviewId: "review_bg1_reapproved",
        review: { ...review, reviewId: "review_bg1_reapproved" },
      };
      const reviewedAgain = await child({
        ...input,
        receipt: newReview,
        ...reviewInvocation(mode, fourthId),
      });
      const reapproved = approvedBroadcastSendRequest(
        reviewedAgain.result.operation,
        thirdId,
        { operationId, expectedOperationVersion: 1 },
      );
      const executableReceipt = {
        ...executable,
        operationVersion: 2,
        reviewId: newReview.reviewId,
      };
      const resumed = await child({
        ...input,
        receipt: executableReceipt,
        ...sendInvocation(mode, saved(reapproved)),
      });
      assert.equal(resumed.result.operation.executionAuthorized, true);
      assert.equal(resumed.result.operation.operationId, operationId);
      assert.deepEqual(resumed.calls[0].body.resume, {
        operationId,
        expectedOperationVersion: 1,
      });
      assert.equal(resumed.calls[0].body.reviewId, newReview.reviewId);
      const superseded = {
        ...processing,
        operationVersion: 2,
        reviewId: newReview.reviewId,
        outcome: "rejected",
        blocker: { code: "request_superseded" },
      };
      const old = await child({
        ...input,
        receipt: superseded,
        ...recoverInvocation(mode, secondId),
      });
      assert.equal(old.result.reason, "request_superseded");
      const retired = await child({
        ...input,
        receipt: executableReceipt,
        ...recoverInvocation(mode, secondId),
      });
      assert.equal(retired.result.reason, "request_superseded");
      assert.equal(
        retired.calls.length,
        0,
        "known superseded input is never POSTed again",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

for (const mode of ["cli", "mcp"])
  test(`fresh ${mode} zero-recipient review and rejection never imply execution`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "fon813-empty-"));
    try {
      const input = {
        mode,
        storeDirectory: join(directory, "inputs"),
        serverState: join(directory, "server.json"),
      };
      const reviewed = await child({
        ...input,
        receipt: zeroReady,
        ...reviewInvocation(mode),
      });
      assert.equal(reviewed.result.operation.summary.recipientCount, 0);
      assert.throws(
        () => approvedBroadcastSendRequest(reviewed.result.operation, secondId),
        /broadcast_audience_empty/u,
      );
      const rejected = {
        ...processing,
        outcome: "rejected",
        blocker: { code: "broadcast_audience_empty" },
      };
      const result = await child({
        ...input,
        receipt: rejected,
        ...sendInvocation(
          mode,
          saved({
            ...sendRequest,
            requestId: secondId,
            reviewDigest: zeroReady.review.reviewDigest,
          }),
        ),
      });
      assert.equal(result.result.reason, "broadcast_audience_empty");
      assert.equal(result.result.operation.executionAuthorized, false);
      assert.doesNotMatch(
        renderBroadcastCommand(result.result, false),
        /Sending|completed/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

async function child(input) {
  // execFile cannot write stdin; a JSON argument is read by the bounded fixture process.
  const source = resolve("tests/fixtures/broadcast-bg1-process.mjs");
  const file = join(
    input.storeDirectory,
    "..",
    `invocation-${Math.random().toString(16).slice(2)}.json`,
  );
  await writeFile(file, JSON.stringify(input));
  const { stdout } = await execute(process.execPath, [source, file], {
    cwd: resolve("."),
    env: process.env,
  });
  return JSON.parse(stdout);
}
function sendInvocation(mode, input) {
  return mode === "cli"
    ? {
        args: [
          "broadcast",
          "send",
          "--send-input",
          JSON.stringify(input),
          "--json",
        ],
      }
    : { tool: "send", payload: { send_input: input } };
}
function recoverInvocation(mode, id) {
  return mode === "cli"
    ? {
        args: [
          "broadcast",
          "send",
          "recover",
          "--workspace",
          scope.workspace,
          "--environment",
          scope.environment,
          "--draft-id",
          scope.draftId,
          "--request-id",
          id,
          "--json",
        ],
      }
    : { tool: "recover", payload: { ...scope, request_id: id } };
}
function reviewInvocation(mode, id = requestId) {
  return mode === "cli"
    ? {
        args: [
          "broadcast",
          "review",
          "--workspace",
          scope.workspace,
          "--environment",
          scope.environment,
          "--draft-id",
          scope.draftId,
          "--request-id",
          id,
          "--expected-version",
          "1",
          "--json",
        ],
      }
    : {
        tool: "review",
        payload: { ...scope, request: { ...reviewRequest, requestId: id } },
      };
}
