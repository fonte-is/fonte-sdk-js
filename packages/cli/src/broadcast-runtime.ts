import { join } from "node:path";
import { createBroadcastFileStore } from "./broadcast-file-store.js";
import type { BroadcastRequestStore } from "./broadcast-contracts.js";
import { BROADCAST_CONTROL_BYTES } from "./broadcast-validation.js";
import { userDataDirectory } from "./credential-store/user-private-file-store.js";
import {
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import type { BroadcastMcpProvider } from "./mcp-broadcast-bg-tools.js";
import { resolveAuthorizedWorkspaceId } from "./operator-workspace-catalog-client.js";

export interface BroadcastRuntimeOptions extends McpClientAuthOptions {
  readonly store?: BroadcastRequestStore;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

/** CLI and MCP use the same current-custody boundary and private request store.
 * Auth refresh is admitted only after a 401 with a proven absent Core effect. */
export function createAuthenticatedBroadcastProvider(
  options: BroadcastRuntimeOptions,
): BroadcastMcpProvider {
  const authenticated = createMcpClientAuthProvider({
    ...options,
    maxResponseBytes: BROADCAST_CONTROL_BYTES,
    requestTimeoutMs: 60_000,
  });
  const store =
    options.store ??
    createBroadcastFileStore(join(userDataDirectory(), "broadcast-requests"));
  return async () => {
    const boundary = await authenticated();
    return {
      coreApiBaseUrl: boundary.hosted.coreApiBaseUrl,
      request: boundary.request,
      fetch: options.fetch,
      store,
      resolveWorkspaceId: (workspace, timeoutMs) =>
        resolveAuthorizedWorkspaceId(boundary.request, workspace, timeoutMs),
      signal: options.signal,
      sleep:
        options.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds))),
      now: options.now,
    };
  };
}
