import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  audienceOptions,
  audiencePreview,
  bearer,
  broadcastId,
  cancelledId,
  draftEnvelope,
  draftId,
  finalResult,
  hostedConfig,
  preflight,
  progress,
  purposeId,
  queued,
  reuseOverride,
  testId,
  testReadback,
} from "./cli-production-broadcast-responses.mjs";

export async function openFakeCore(context) {
  const state = { requests: [], testReads: 0, progressReads: 0 };
  const server = createServer((request, response) =>
    handleRequest(state, server, request, response),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return {
    state,
    configUrl: `${serverUrl(server)}/.well-known/fonte-cli.json`,
  };
}

async function handleRequest(state, server, request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/.well-known/fonte-cli.json") {
    return send(response, hostedConfig(serverUrl(server)));
  }
  assert.equal(request.headers.authorization, `Bearer ${bearer}`);
  const body = request.method === "POST" ? await requestBody(request) : null;
  state.requests.push({
    method: request.method,
    path: `${url.pathname}${url.search}`,
    body,
    idempotencyKey: request.headers["idempotency-key"] ?? null,
  });
  if (url.pathname.endsWith("/broadcast-drafts") && request.method === "POST") {
    assert.equal(request.headers["idempotency-key"], draftId);
    assert.equal(body.audienceKind, "recipient_expression");
    assert.equal(body.communicationPurposeId, purposeId);
    return send(response, draftEnvelope("applied"), 201);
  }
  if (url.pathname.endsWith(`/broadcast-drafts/${draftId}`)) {
    return send(response, draftEnvelope(null));
  }
  if (url.pathname.endsWith("/audience-options")) {
    return send(response, audienceOptions());
  }
  if (url.pathname.endsWith(`/broadcast-drafts/${draftId}/audience-preview`)) {
    return send(response, audiencePreview());
  }
  if (url.pathname.endsWith(`/marketing-broadcasts/${draftId}/preflight`)) {
    assert.deepEqual(body.audienceReuseOverride, reuseOverride());
    return send(response, preflight());
  }
  if (
    url.pathname.endsWith(`/marketing-broadcasts/${draftId}/send-approvals`)
  ) {
    if (body.operation === "send_test_to_verified_account") {
      assert.equal("recipients" in body, false);
      return send(response, queued("test"), 201);
    }
    assert.equal(body.operation, "authorize_persisted_production");
    assert.equal("textBody" in body, false);
    assert.deepEqual(body.audienceReuseOverride, reuseOverride());
    return send(response, queued("production"), 201);
  }
  if (
    url.pathname.endsWith(
      `/broadcast-drafts/${draftId}/test-deliveries/${testId}`,
    )
  ) {
    state.testReads += 1;
    return send(
      response,
      testReadback(state.testReads === 1 ? "processing" : "terminal"),
    );
  }
  if (url.pathname.endsWith(`/marketing-broadcasts/${broadcastId}/progress`)) {
    state.progressReads += 1;
    return send(
      response,
      progress(state.progressReads === 1 ? "processing" : "terminal"),
    );
  }
  if (url.pathname.endsWith(`/marketing-broadcasts/${broadcastId}/control`)) {
    return send(
      response,
      progress(body.operation === "pause" ? "paused" : "processing"),
    );
  }
  if (url.pathname.endsWith(`/marketing-broadcasts/${cancelledId}/control`)) {
    assert.equal(body.operation, "cancel_remaining");
    return send(response, progress("cancelled", cancelledId));
  }
  if (url.pathname.endsWith(`/marketing-broadcasts/${broadcastId}/results`)) {
    return send(response, finalResult());
  }
  return send(response, { error: "synthetic_route_missing" }, 404);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function serverUrl(server) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
