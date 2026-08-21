import {
  CoreOperatorError,
  type CoreOperatorClient,
} from "./operator-client.js";
import type {
  ProviderConnectionListResult,
  ProviderConnectionOAuthResult,
  ProviderConnectionOperatorCommand,
} from "./operator-provider-connection-types.js";
import type { OperatorResult } from "./operator-types.js";

type ProviderConnectionResult =
  ProviderConnectionListResult | ProviderConnectionOAuthResult;

export async function executeProviderConnectionCommand(
  command: ProviderConnectionOperatorCommand,
  client: CoreOperatorClient,
  randomUUID: () => string,
  openUrl: ((url: URL) => Promise<boolean>) | undefined,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<ProviderConnectionResult> {
  if (command.kind === "bridge_connection_list") {
    return client.listProviderConnections(command);
  }
  const attemptId = randomUUID();
  const connectionId =
    command.kind === "bridge_connection_connect"
      ? randomUUID()
      : command.connectionId;
  const input = {
    workspace: command.workspace,
    environment: command.environment,
    provider: command.provider,
    attemptId,
    connectionId,
    displayName: command.displayName,
    operation:
      command.kind === "bridge_connection_connect" ? "connect" : "reconnect",
    expectedCredentialVersion:
      command.kind === "bridge_connection_connect"
        ? null
        : command.expectedCredentialVersion,
  } as const;
  let begun: ProviderConnectionOAuthResult;
  try {
    begun = await client.beginProviderConnectionOAuth(input);
  } catch (error) {
    if (isAmbiguous(error, false)) {
      return unknownResult(
        command.provider,
        input.operation,
        attemptId,
        connectionId,
      );
    }
    throw error;
  }
  if (begun.status !== "waiting") return begun;
  const authorizationUrl = begun.authorization_url;
  if (!authorizationUrl) {
    return unknownResult(
      command.provider,
      input.operation,
      attemptId,
      connectionId,
    );
  }
  const opened = openUrl ? await openUrl(new URL(authorizationUrl)) : false;
  if (!opened) return begun;
  let current = begun;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await sleep(current.poll_after_milliseconds ?? 1_000);
    try {
      current = await client.readProviderConnectionOAuth({
        workspace: command.workspace,
        environment: command.environment,
        provider: command.provider,
        attemptId,
      });
    } catch (error) {
      if (isAmbiguous(error, true)) {
        return {
          ...current,
          status: "unknown",
          reason: "completion_unknown",
          authorization_url: null,
          connection: null,
        };
      }
      throw error;
    }
    if (current.status !== "waiting") return current;
  }
  return {
    ...current,
    status: "unknown",
    reason: "completion_unknown",
    authorization_url: null,
    connection: null,
  };
}

export function providerConnectionReceiptDescriptor(result: OperatorResult): {
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect:
    "none" | "created" | "replaced" | "attempted" | "unknown";
} | null {
  if (result.kind === "provider_connections") {
    return {
      outcome: "completed",
      reason: "provider_connections_listed",
      coreEffect: "none",
    };
  }
  if (result.kind !== "provider_connection_oauth") return null;
  if (result.status === "ready") {
    return {
      outcome: "completed",
      reason: `provider_connection_${result.operation}_completed`,
      coreEffect: result.operation === "connect" ? "created" : "replaced",
    };
  }
  return {
    outcome: "blocked",
    reason: `provider_connection_${result.reason}`,
    coreEffect:
      result.status === "waiting"
        ? "attempted"
        : result.status === "unknown"
          ? "unknown"
          : "none",
  };
}

export function isProviderConnectionCommand(command: {
  readonly kind: string;
}): command is ProviderConnectionOperatorCommand {
  return command.kind.startsWith("bridge_connection_");
}

function isAmbiguous(error: unknown, polling: boolean): boolean {
  if (!(error instanceof CoreOperatorError)) return false;
  if (error.coreEffect === "unknown") return true;
  if (
    error.statusCode !== null &&
    error.statusCode >= 500 &&
    (polling || error.reason !== "provider_oauth_unavailable")
  ) {
    return true;
  }
  return (
    polling &&
    (error.reason === "core_api_unavailable" ||
      error.reason === "core_operator_receipt_invalid")
  );
}

function unknownResult(
  provider: ProviderConnectionOAuthResult["provider"],
  operation: ProviderConnectionOAuthResult["operation"],
  attemptId: string,
  connectionId: string,
): ProviderConnectionOAuthResult {
  return {
    kind: "provider_connection_oauth",
    provider,
    operation,
    attempt_id: attemptId,
    connection_id: connectionId,
    requested_scope: provider === "resend" ? "full_access" : null,
    status: "unknown",
    reason: "completion_unknown",
    authorization_url: null,
    expires_at: null,
    poll_after_milliseconds: null,
    connection: null,
  };
}
