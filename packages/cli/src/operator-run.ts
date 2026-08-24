import type { HostedConfig } from "./hosted-config.js";
import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  createCoreOperatorClient,
  CoreOperatorError,
} from "./operator-client.js";
import {
  executeProviderAudienceCommand,
  providerAudienceReceiptDescriptor,
} from "./operator-provider-audience-run.js";
import {
  executeProviderConnectionCommand,
  isProviderConnectionCommand,
  providerConnectionReceiptDescriptor,
} from "./operator-provider-connection-run.js";
import {
  executeProductionCommand,
  isProductionCommand,
  productionReceiptDescriptor,
} from "./operator-production-run.js";
import { runBroadcastCanary } from "./operator-broadcast-canary.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
  SandboxTestResult,
} from "./operator-types.js";
export interface OperatorDependencies {
  readonly configUrl?: string;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  authorize(config: HostedConfig, signal?: AbortSignal): Promise<string>;
  renewAuthorization?(
    config: HostedConfig,
    signal?: AbortSignal,
    force?: boolean,
  ): Promise<string>;
  sleep(milliseconds: number): Promise<void>;
  openUrl?(url: URL): Promise<boolean>;
  readonly signal?: AbortSignal;
  now?(): Date;
}
export async function runOperatorCommand(
  command: OperatorCommand,
  dependencies: OperatorDependencies,
  randomUUID: () => string,
): Promise<OperatorReceipt> {
  if (command.kind === "unsupported") return unsupportedReceipt();
  if (command.kind === "broadcast_canary") {
    return runBroadcastCanary(command, dependencies, randomUUID(), randomUUID);
  }
  try {
    const config = await loadHostedConfig(
      dependencies.fetch as typeof fetch,
      dependencies.configUrl,
    );
    const bearer = await dependencies.authorize(config, dependencies.signal);
    const client = createCoreOperatorClient({
      coreApiBaseUrl: config.coreApiBaseUrl,
      bearer,
      fetch: dependencies.fetch as typeof fetch,
      signal: dependencies.signal,
    });
    const result = await execute(
      command,
      client,
      randomUUID,
      dependencies.openUrl,
      dependencies.sleep,
    );
    return successReceipt(command, result);
  } catch (error) {
    const core = error instanceof CoreOperatorError ? error : null;
    return {
      schema_version: "fonte.cli.operator_receipt.v1",
      command: command.kind,
      outcome: "blocked",
      reason:
        core?.reason ??
        (error instanceof HostedTestBlockedError
          ? error.reason
          : "operator_request_failed"),
      workspace: command.workspace,
      authority: currentAuthority(command),
      core_effect: core?.coreEffect ?? "none",
      result: null,
    };
  }
}
async function execute(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  client: ReturnType<typeof createCoreOperatorClient>,
  randomUUID: () => string,
  openUrl: ((url: URL) => Promise<boolean>) | undefined,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OperatorResult> {
  if (isProviderConnectionCommand(command)) {
    return executeProviderConnectionCommand(
      command,
      client,
      randomUUID,
      openUrl,
      sleep,
    );
  }
  if (isProductionCommand(command)) {
    return executeProductionCommand(command, client, sleep);
  }
  if (command.kind === "broadcast_test_send") {
    return client.sendSandboxTest({
      workspace: command.workspace,
      draftId: command.draftId,
      revision: command.revision,
      idempotencyKey: command.idempotencyKey,
    });
  }
  if (command.kind === "broadcast_test_status") {
    const read = () =>
      client.readSandboxTest({
        workspace: command.workspace,
        testId: command.testId,
      });
    return command.watch ? poll(read, sleep) : read();
  }
  if (command.kind === "broadcast_preflight") {
    return client.preflightBroadcast({
      workspace: command.workspace,
      environment: command.environment,
      draftId: command.draftId,
      expectedVersion: command.expectedVersion,
      postalAddress: command.postalAddress,
      audienceReuseOverride: command.audienceReuseOverride,
    });
  }
  if (command.kind === "bridge_resend_preview") {
    return client.previewResendSegment({
      workspace: command.workspace,
      environment: command.environment,
      segmentId: command.segmentId,
    });
  }
  if (command.kind === "bridge_resend_copy") {
    return client.copyResendSegment({
      workspace: command.workspace,
      environment: command.environment,
      segmentId: command.segmentId,
      expectedObservationFingerprint: command.observationFingerprint,
      idempotencyKey: command.idempotencyKey,
    });
  }
  const providerAudience = executeProviderAudienceCommand(command, client);
  if (providerAudience) return providerAudience;
  throw new TypeError("operator_command_unmappable");
}
async function poll(
  read: () => Promise<SandboxTestResult>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<SandboxTestResult> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await read();
    if (result.status === "terminal") return result;
    await sleep(Math.min(result.poll_after_milliseconds ?? 1_000, 2_000));
  }
  throw new CoreOperatorError("core_readback_timeout", null, "none");
}
function successReceipt(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
): OperatorReceipt {
  const production = productionReceiptDescriptor(command, result);
  if (production) {
    return currentReceipt(
      command,
      result,
      production.outcome,
      production.reason,
      production.coreEffect,
    );
  }
  if (result.kind === "broadcast_preflight") {
    return currentReceipt(
      command,
      result,
      result.ready ? "completed" : "blocked",
      result.ready
        ? "broadcast_preflight_ready"
        : "broadcast_preflight_blocked",
      "none",
    );
  }
  if (result.kind === "resend_bridge_preview") {
    return currentReceipt(
      command,
      result,
      "completed",
      `resend_bridge_observation_${result.pagination.status}`,
      "none",
    );
  }
  if (result.kind === "resend_bridge_copy") {
    return currentReceipt(
      command,
      result,
      "completed",
      result.import_receipt.created
        ? "resend_bridge_copy_completed"
        : "resend_bridge_copy_idempotent",
      result.import_receipt.created ? "copied" : "none",
    );
  }
  const providerAudience = providerAudienceReceiptDescriptor(result);
  if (providerAudience) {
    return currentReceipt(
      command,
      result,
      providerAudience.outcome,
      providerAudience.reason,
      providerAudience.coreEffect,
    );
  }
  const providerConnection = providerConnectionReceiptDescriptor(result);
  if (providerConnection) {
    return currentReceipt(
      command,
      result,
      providerConnection.outcome,
      providerConnection.reason,
      providerConnection.coreEffect,
    );
  }
  if (result.kind !== "sandbox_test") {
    throw new TypeError("operator_receipt_unmappable");
  }
  return currentReceipt(
    command,
    result,
    result.status === "queued"
      ? "queued"
      : result.status === "terminal"
        ? "terminal"
        : "completed",
    `sandbox_test_${result.status}`,
    result.status === "queued" ? "queued" : "none",
  );
}
function currentReceipt(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
  outcome: "queued" | "terminal" | "completed" | "blocked",
  reason: string,
  coreEffect:
    | "none"
    | "created"
    | "replaced"
    | "attempted"
    | "queued"
    | "controlled"
    | "copied"
    | "unknown",
): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome,
    reason,
    workspace: command.workspace,
    authority: currentAuthority(command),
    core_effect: coreEffect,
    result,
  };
}

function unsupportedReceipt(): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: "unsupported",
    outcome: "unsupported_authority",
    reason: "unsupported_authority",
    workspace: null,
    authority: { status: "missing", contract_id: "unavailable" },
    core_effect: "none",
    result: null,
  };
}
function currentAuthority(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
): OperatorReceipt["authority"] {
  return {
    status: "current",
    contract_id:
      command.kind === "broadcast_preflight"
        ? "fonte.core.broadcast_preflight.v1"
        : command.kind === "broadcast_audience_append"
          ? "fonte.core.production_broadcast_audience_append.v1"
        : command.kind.startsWith("broadcast_") &&
            command.kind !== "broadcast_test_send" &&
            command.kind !== "broadcast_test_status"
          ? "fonte.core.production_broadcast.v1"
          : command.kind === "bridge_contact_import_status"
            ? "fonte.core.contact_import.v1"
            : command.kind.startsWith("bridge_resend_")
              ? "fonte.core.resend_bridge.v1"
              : command.kind.startsWith("bridge_connection_")
                ? "fonte.core.provider_connections.v1"
                : command.kind.startsWith("bridge_provider_")
                  ? "fonte.core.provider_audience.v1"
                  : "fonte.core.sandbox_canary.v1",
  };
}
