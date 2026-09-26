import { coreError } from "./operator-json.js";

export interface CoreRequestOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
  /** Shared ceiling for GET, mutation and the response body read. */
  readonly timeoutMs?: number;
}

export interface CorePostOptions {
  /** POST remains the default; revisioned Core commands may require PUT/PATCH. */
  readonly method?: "POST" | "PUT" | "PATCH";
  readonly idempotencyKey?: string;
  readonly body: Record<string, unknown>;
  readonly lostResponseEffect: "none" | "unknown";
  readonly timeoutMs?: number;
}

export interface CoreReadOptions {
  readonly timeoutMs?: number;
}

export type CoreRequester = (
  path: string,
  options?: CorePostOptions | CoreReadOptions,
) => Promise<unknown>;

export class CoreOperatorError extends Error {
  constructor(
    readonly reason: string,
    readonly statusCode: number | null,
    readonly coreEffect: "none" | "unknown",
  ) {
    super(reason);
    this.name = "CoreOperatorError";
  }
}

export function createCoreRequester(
  options: CoreRequestOptions,
): CoreRequester {
  const baseUrl = validatedBaseUrl(options.coreApiBaseUrl);
  const bearer = options.bearer.trim();
  if (!bearer || /\s/.test(bearer)) {
    throw new CoreOperatorError("authorization_token_missing", null, "none");
  }
  const maxResponseBytes = responseLimitBytes(options.maxResponseBytes);
  const defaultTimeoutMs = requestTimeoutMs(options.timeoutMs);
  return async (path, callOptions) => {
    if (options.signal?.aborted) {
      throw new CoreOperatorError("operation_cancelled", null, "none");
    }
    const post = callOptions && "body" in callOptions ? callOptions : undefined;
    const timeoutMs =
      callOptions?.timeoutMs === undefined
        ? defaultTimeoutMs
        : requestTimeoutMs(callOptions.timeoutMs);
    const request = preparedRequest(baseUrl, bearer, path, post);
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    let response: Response;
    try {
      response = await options.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "error",
        signal,
      });
    } catch {
      if (options.signal?.aborted) {
        throw new CoreOperatorError(
          "operation_cancelled",
          null,
          post?.lostResponseEffect ?? "none",
        );
      }
      throw new CoreOperatorError(
        "core_api_unavailable",
        null,
        post?.lostResponseEffect ?? "none",
      );
    }
    let rawBody: Uint8Array;
    try {
      rawBody = await readResponseBody(response, maxResponseBytes, signal);
    } catch (error) {
      if (error instanceof ResponseLimitExceeded) {
        throw new CoreOperatorError(
          "core_response_too_large",
          response.ok ? null : response.status,
          response.ok
            ? (post?.lostResponseEffect ?? "none")
            : failureEffect(post, response.status, "core_response_too_large"),
        );
      }
      if (options.signal?.aborted) {
        throw new CoreOperatorError(
          "operation_cancelled",
          null,
          post?.lostResponseEffect ?? "none",
        );
      }
      throw new CoreOperatorError(
        "core_api_unavailable",
        null,
        post?.lostResponseEffect ?? "none",
      );
    }
    const parsed = parseResponseBody(rawBody);
    if (!response.ok) {
      const reason = coreError(
        parsed.ok ? parsed.value : null,
        response.status,
      );
      throw new CoreOperatorError(
        reason,
        response.status,
        failureEffect(post, response.status, reason),
      );
    }
    if (!parsed.ok || parsed.value === null) {
      throw new CoreOperatorError(
        "core_operator_receipt_invalid",
        null,
        post?.lostResponseEffect ?? "none",
      );
    }
    return parsed.value;
  };
}

interface PreparedRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

function preparedRequest(
  baseUrl: string,
  bearer: string,
  path: string,
  post: CorePostOptions | undefined,
): PreparedRequest {
  const url = validatedRequestUrl(baseUrl, path);
  const method = requestMethod(post?.method, post !== undefined);
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${bearer}`,
    ...(post
      ? {
          "content-type": "application/json",
          ...(post.idempotencyKey
            ? { "idempotency-key": post.idempotencyKey }
            : {}),
        }
      : {}),
  };
  try {
    new Headers(headers);
  } catch {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  let body: string | undefined;
  try {
    body = post ? JSON.stringify(post.body) : undefined;
  } catch {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  if (post && body === undefined) {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  return { url, method, headers, body };
}

function requestMethod(
  method: CorePostOptions["method"],
  hasBody: boolean,
): PreparedRequest["method"] {
  if (!hasBody) return "GET";
  if (method === undefined) return "POST";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    return method;
  }
  throw new CoreOperatorError("core_request_invalid", null, "none");
}

function responseLimitBytes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_048_576) {
    throw new CoreOperatorError("core_response_limit_invalid", null, "none");
  }
  return value;
}

class ResponseLimitExceeded extends Error {}

async function readResponseBody(
  response: Response,
  maxBytes: number | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = contentLength(response.headers.get("content-length"));
  if (
    maxBytes !== undefined &&
    declaredLength !== null &&
    declaredLength > maxBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseLimitExceeded();
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await readChunk(reader, signal);
      if (result.done) break;
      const nextLength = length + result.value.byteLength;
      if (maxBytes !== undefined && nextLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseLimitExceeded();
      }
      chunks.push(result.value);
      length = nextLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    void reader.cancel(signal.reason).catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function contentLength(value: string | null): number | null {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function parseResponseBody(
  body: Uint8Array,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false };
  }
}

function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined) return 15_000;
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new CoreOperatorError("core_request_timeout_invalid", null, "none");
  }
  return value;
}

export function parseCoreReceipt<T>(
  parser: (value: unknown) => T,
  value: unknown,
  coreEffect: "none" | "unknown" = "none",
): T {
  try {
    return parser(value);
  } catch {
    throw new CoreOperatorError(
      "core_operator_receipt_invalid",
      null,
      coreEffect,
    );
  }
}

function failureEffect(
  post: CorePostOptions | undefined,
  status: number,
  reason: string,
): "none" | "unknown" {
  if (post?.lostResponseEffect !== "unknown" || status < 500) return "none";
  if (
    reason === "resend_bridge_unavailable" ||
    reason === "resend_bridge_provider_unavailable" ||
    reason === "provider_oauth_unavailable"
  ) {
    return "none";
  }
  return "unknown";
}

function validatedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoreOperatorError("core_api_base_url_invalid", null, "none");
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CoreOperatorError("core_api_base_url_invalid", null, "none");
  }
  return url.toString().replace(/\/$/, "");
}

function validatedRequestUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//u.test(path)) {
    try {
      return validateCoreRequestUrl(path, baseUrl);
    } catch {
      throw new CoreOperatorError("core_request_invalid", null, "none");
    }
  }
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  const base = new URL(baseUrl);
  const url = new URL(`${baseUrl}${path}`);
  if (url.origin !== base.origin || url.hash) {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  return url.toString();
}

/** Returned operation references carry no authority to forward authentication off-origin. */
export function validateCoreRequestUrl(path: string, baseUrl: string): string {
  try {
    const base = new URL(validatedBaseUrl(baseUrl));
    const target = new URL(path, base);
    if (
      typeof path !== "string" ||
      /[\u0000-\u0020\u007f]/u.test(path) ||
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      target.hash ||
      !["http:", "https:"].includes(target.protocol)
    )
      throw new TypeError("origin");
    return target.href;
  } catch {
    throw new CoreOperatorError("core_operation_uri_invalid", null, "none");
  }
}
