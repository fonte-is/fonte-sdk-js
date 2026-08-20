import { coreError, queuedSandboxTest, sandboxTest } from "./operator-json.js";
import type { SandboxTestResult } from "./operator-types.js";

export type { OperatorCommand, OperatorReceipt } from "./operator-types.js";

export interface CoreOperatorClientOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
}

export interface CoreOperatorClient {
  sendSandboxTest(input: SandboxTestSendInput): Promise<SandboxTestResult>;
  readSandboxTest(input: SandboxTestReadInput): Promise<SandboxTestResult>;
}

export interface SandboxTestSendInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly revision: number;
  readonly idempotencyKey: string;
}

export interface SandboxTestReadInput {
  readonly workspace: string;
  readonly testId: string;
}

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

export function createCoreOperatorClient(
  options: CoreOperatorClientOptions,
): CoreOperatorClient {
  const baseUrl = validatedBaseUrl(options.coreApiBaseUrl);
  const bearer = options.bearer.trim();
  if (!bearer || /\s/.test(bearer)) {
    throw new CoreOperatorError("authorization_token_missing", null, "none");
  }
  const request = requester(baseUrl, bearer, options.fetch);
  return {
    async sendSandboxTest(input) {
      const response = await request(
        `/v1/workspaces/${segment(input.workspace)}/email-sandbox/canaries?environment=sandbox`,
        {
          idempotencyKey: input.idempotencyKey,
          body: {
            broadcastDraftId: input.draftId,
            draftVersion: input.revision,
            idempotencyKey: input.idempotencyKey,
          },
        },
      );
      return parseCurrent(queuedSandboxTest, response, "unknown");
    },
    async readSandboxTest(input) {
      return parseCurrent(
        sandboxTest,
        await request(
          `/v1/workspaces/${segment(input.workspace)}/email-sandbox/canaries/${segment(input.testId)}?environment=sandbox`,
        ),
      );
    },
  };
}

interface MutationOptions {
  readonly idempotencyKey: string;
  readonly body: Record<string, unknown>;
}

function requester(
  baseUrl: string,
  bearer: string,
  fetcher: typeof fetch,
): (path: string, options?: MutationOptions) => Promise<unknown> {
  return async (path, options) => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method: options ? "POST" : "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${bearer}`,
          ...(options
            ? {
                "content-type": "application/json",
                "idempotency-key": options.idempotencyKey,
              }
            : {}),
        },
        ...(options ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CoreOperatorError(
        "core_api_unavailable",
        null,
        options ? "unknown" : "none",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new CoreOperatorError(
        coreError(body, response.status),
        response.status,
        options && response.status >= 500 ? "unknown" : "none",
      );
    }
    return body;
  };
}

function parseCurrent<T>(
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

function segment(value: string): string {
  return encodeURIComponent(value);
}
