import { coreError } from "./operator-json.js";

export interface CoreRequestOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
}

export interface CorePostOptions {
  readonly idempotencyKey?: string;
  readonly body: Record<string, unknown>;
  readonly lostResponseEffect: "none" | "unknown";
}

export type CoreRequester = (
  path: string,
  post?: CorePostOptions,
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
  return async (path, post) => {
    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method: post ? "POST" : "GET",
        headers: {
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
        },
        ...(post ? { body: JSON.stringify(post.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CoreOperatorError(
        "core_api_unavailable",
        null,
        post?.lostResponseEffect ?? "none",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = coreError(body, response.status);
      throw new CoreOperatorError(
        reason,
        response.status,
        failureEffect(post, response.status, reason),
      );
    }
    return body;
  };
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
    reason === "resend_bridge_provider_unavailable"
  ) {
    return "none";
  }
  return "unknown";
}

function validatedBaseUrl(value: string): string {
  const url = new URL(value);
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
