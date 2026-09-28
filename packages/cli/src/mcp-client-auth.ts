import type { ClientAuthRuntime } from "./client-auth-runtime.js";
import { loadHostedConfig, type HostedConfig } from "./hosted-config.js";
import {
  CoreOperatorError,
  createCoreRequester,
  type CoreRequester,
} from "./operator-core-request.js";

const CORE_RESPONSE_LIMIT_BYTES = 1_048_576;

export interface McpClientAuthOptions {
  readonly configUrl?: string;
  readonly fetch: typeof fetch;
  readonly authorize: ClientAuthRuntime["authorize"];
  readonly renewAuthorization?: ClientAuthRuntime["renewAuthorization"];
  readonly signal?: AbortSignal;
  /** Domain-specific bounds; other clients retain the existing defaults. */
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

export interface McpAuthenticatedBoundary {
  readonly hosted: HostedConfig;
  readonly request: CoreRequester;
}

export type McpClientAuthProvider = () => Promise<McpAuthenticatedBoundary>;

/** Acquires current local custody once for each authenticated MCP tool call. */
export function createMcpClientAuthProvider(
  options: McpClientAuthOptions,
): McpClientAuthProvider {
  return async () => {
    const hosted = await loadHostedConfig(options.fetch, options.configUrl);
    let bearer = await options.authorize(hosted, options.signal);
    let request = requester(options, hosted, bearer);
    let refreshed = false;

    return {
      hosted,
      request: async (path, post) => {
        try {
          return await request(path, post);
        } catch (error) {
          if (
            refreshed ||
            options.renewAuthorization === undefined ||
            !refreshAdmitted(error)
          ) {
            throw error;
          }
          refreshed = true;
          bearer = await options.renewAuthorization(
            hosted,
            options.signal,
            true,
          );
          request = requester(options, hosted, bearer);
          return request(path, post);
        }
      },
    };
  };
}

function requester(
  options: McpClientAuthOptions,
  hosted: HostedConfig,
  bearer: string,
): CoreRequester {
  return createCoreRequester({
    coreApiBaseUrl: hosted.coreApiBaseUrl,
    bearer,
    fetch: options.fetch,
    maxResponseBytes: options.maxResponseBytes ?? CORE_RESPONSE_LIMIT_BYTES,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
}

function refreshAdmitted(error: unknown): boolean {
  return (
    error instanceof CoreOperatorError &&
    error.reason === "human_auth_invalid" &&
    error.statusCode === 401 &&
    error.coreEffect === "none"
  );
}
