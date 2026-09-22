import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreOperatorError,
  createCoreRequester,
} from "../packages/cli/dist/operator-core-request.js";

const baseUrl = "https://api.example.test";
const bearer = "synthetic.header.signature";
const mutation = {
  idempotencyKey: "operation-synthetic-1",
  body: { operationId: "operation-synthetic-1", expectedRevision: 4 },
  lostResponseEffect: "unknown",
};

test("GET, POST, PUT, and PATCH keep their exact method and serialized body", async () => {
  const calls = [];
  const request = requester(async (input, init) => {
    calls.push({
      url: String(input),
      method: init.method,
      body: init.body ?? null,
      redirect: init.redirect,
    });
    return json({ accepted: true });
  });

  await request("/v1/read");
  await request("/v1/post", command());
  await request("/v1/put", command({ method: "PUT" }));
  await request("/v1/patch", command({ method: "PATCH" }));

  assert.deepEqual(
    calls.map(({ method }) => method),
    ["GET", "POST", "PUT", "PATCH"],
  );
  assert.equal(calls[0].body, null);
  assert.deepEqual(
    calls.slice(1).map(({ body }) => body),
    Array(3).fill(JSON.stringify(mutation.body)),
  );
  assert.equal(
    calls.every(({ redirect }) => redirect === "error"),
    true,
  );
});

test("invalid request construction fails before dispatch", async () => {
  let calls = 0;
  const request = requester(async () => {
    calls += 1;
    return json({ accepted: true });
  });

  await rejectsCore(
    request("https://other.example.test/v1/command", command()),
    "core_request_invalid",
    "none",
  );
  await rejectsCore(
    request("/v1/command", command({ body: { invalid: 1n } })),
    "core_request_invalid",
    "none",
  );
  assert.equal(calls, 0);
});

test("an already-aborted signal dispatches nothing and has no Core effect", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const request = requester(
    async () => {
      calls += 1;
      return json({ accepted: true });
    },
    { signal: controller.signal },
  );

  await rejectsCore(
    request("/v1/command", command()),
    "operation_cancelled",
    "none",
  );
  assert.equal(calls, 0);
});

test("parent cancellation after a mutation dispatch preserves unknown effect", async () => {
  const controller = new AbortController();
  let committed = false;
  const request = requester(
    async () => {
      committed = true;
      controller.abort();
      throw new DOMException("response lost", "AbortError");
    },
    { signal: controller.signal },
  );

  await rejectsCore(
    request("/v1/command", command()),
    "operation_cancelled",
    "unknown",
  );
  assert.equal(committed, true);
});

test("parent cancellation after a read dispatch keeps no Core effect", async () => {
  const controller = new AbortController();
  const request = requester(
    async () => {
      controller.abort();
      throw new DOMException("read cancelled", "AbortError");
    },
    { signal: controller.signal },
  );

  await rejectsCore(request("/v1/read"), "operation_cancelled", "none");
});

test("one deadline covers response headers and preserves mutation uncertainty", async () => {
  const request = requester(
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
  );

  await rejectsCore(
    request("/v1/command", command({ timeoutMs: 5 })),
    "core_api_unavailable",
    "unknown",
  );
});

test("the same deadline cancels a stalled response body", async () => {
  let cancelled = false;
  const request = requester(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  await rejectsCore(
    request("/v1/command", command({ timeoutMs: 5 })),
    "core_api_unavailable",
    "unknown",
  );
  assert.equal(cancelled, true);
});

test("malformed and null successful mutation receipts remain unknown", async () => {
  for (const body of ["not-json", "null", ""]) {
    const request = requester(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await rejectsCore(
      request("/v1/command", command()),
      "core_operator_receipt_invalid",
      "unknown",
    );
  }
});

test("known HTTP denials and conflicts stay pre-effect while 5xx stays unknown", async () => {
  for (const [status, reason, effect] of [
    [401, "human_auth_invalid", "none"],
    [403, "capability_denied", "none"],
    [409, "revision_conflict", "none"],
    [503, "core_busy", "unknown"],
  ]) {
    const request = requester(async () => json({ error: reason }, status));
    await rejectsCore(
      request("/v1/command", command()),
      reason,
      effect,
      status,
    );
  }
});

test("an explicit retry preserves operation identity and the exact body", async () => {
  const calls = [];
  const request = requester(async (input, init) => {
    calls.push({
      url: String(input),
      method: init.method,
      idempotencyKey: init.headers["idempotency-key"],
      body: init.body,
    });
    if (calls.length === 1) throw new Error("lost response");
    return json({ outcome: "replayed" });
  });

  await rejectsCore(
    request("/v1/command?environment=sandbox", command({ method: "PATCH" })),
    "core_api_unavailable",
    "unknown",
  );
  assert.equal(calls.length, 1, "the requester must not retry automatically");
  const result = await request(
    "/v1/command?environment=sandbox",
    command({ method: "PATCH" }),
  );
  assert.deepEqual(result, { outcome: "replayed" });
  assert.deepEqual(calls[1], calls[0]);
});

test("lost mutation response followed by renewal failure dispatches no second mutation", async () => {
  const calls = [];
  const request = requester(async (input, init) => {
    calls.push({
      url: String(input),
      method: init.method,
      idempotencyKey: init.headers["idempotency-key"],
      body: init.body,
    });
    throw new Error("lost response after possible commit");
  });

  await rejectsCore(
    request("/v1/command", command()),
    "core_api_unavailable",
    "unknown",
  );
  await assert.rejects(
    Promise.reject(new Error("credential renewal failed")),
    /credential renewal failed/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    url: `${baseUrl}/v1/command`,
    method: "POST",
    idempotencyKey: mutation.idempotencyKey,
    body: JSON.stringify(mutation.body),
  });
});

test("the response limit accepts the exact byte boundary", async () => {
  const body = '{"a":1}';
  const request = requester(async () => textResponse(body), {
    maxResponseBytes: byteLength(body),
  });

  assert.deepEqual(await request("/v1/read"), { a: 1 });
});

test("stream enforcement rejects one byte over a misleading Content-Length", async () => {
  const body = '{"a":1} ';
  let cancelled = false;
  const request = requester(
    async () =>
      streamResponse(body, {
        contentLength: "1",
        onCancel: () => {
          cancelled = true;
        },
      }),
    { maxResponseBytes: byteLength(body) - 1 },
  );

  await rejectsCore(
    request("/v1/command", command()),
    "core_response_too_large",
    "unknown",
  );
  assert.equal(cancelled, true);
});

test("stream enforcement rejects overflow when Content-Length is absent", async () => {
  const body = '{"a":1} ';
  const request = requester(async () => streamResponse(body), {
    maxResponseBytes: byteLength(body) - 1,
  });

  await rejectsCore(request("/v1/read"), "core_response_too_large", "none");
});

test("an oversized declared response is cancelled before accumulation", async () => {
  let cancelled = false;
  const request = requester(
    async () =>
      streamResponse('{"a":1}', {
        contentLength: "100",
        onCancel: () => {
          cancelled = true;
        },
      }),
    { maxResponseBytes: 7 },
  );

  await rejectsCore(
    request("/v1/command", command()),
    "core_response_too_large",
    "unknown",
  );
  assert.equal(cancelled, true);
});

test("response limits accept only positive safe integers up to one MiB", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 1_048_577]) {
    assert.throws(
      () =>
        requester(async () => json({ accepted: true }), {
          maxResponseBytes: value,
        }),
      (error) =>
        error instanceof CoreOperatorError &&
        error.reason === "core_response_limit_invalid" &&
        error.coreEffect === "none",
    );
  }
  assert.doesNotThrow(() =>
    requester(async () => json({ accepted: true }), {
      maxResponseBytes: 1_048_576,
    }),
  );
});

function requester(fetcher, overrides = {}) {
  return createCoreRequester({
    coreApiBaseUrl: baseUrl,
    bearer,
    fetch: fetcher,
    ...overrides,
  });
}

function command(overrides = {}) {
  return {
    ...mutation,
    ...overrides,
  };
}

async function rejectsCore(promise, reason, coreEffect, statusCode = null) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === reason &&
      error.statusCode === statusCode &&
      error.coreEffect === coreEffect,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function streamResponse(body, options = {}) {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(bytes);
      },
      cancel() {
        options.onCancel?.();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...(options.contentLength === undefined
          ? {}
          : { "content-length": options.contentLength }),
      },
    },
  );
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
