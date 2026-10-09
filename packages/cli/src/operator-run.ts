import type { HostedConfig } from "./hosted-config.js";
import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  createCoreOperatorClient,
  CoreOperatorError,
} from "./operator-client.js";
import { withAmbiguousBroadcastRecovery } from "./operator-broadcast-recovery.js";
import {
  broadcastSendInstructionReceiptDescriptor,
  executeBroadcastSendInstructionCommand,
  isBroadcastSendInstructionCommand,
} from "./operator-broadcast-send-instruction-run.js";
import { withAmbiguousSequenceRecovery } from "./operator-sequence-recovery.js";

import {
  executeProductionCommand,
  isProductionCommand,
  productionReceiptDescriptor,
} from "./operator-production-run.js";
import {
  executeWorkspaceMarketingSettingsCommand,
  workspaceMarketingSettingsReceiptDescriptor,
} from "./operator-marketing-settings-run.js";
import {
  executeSequenceCommand,
  isSequenceCommand,
  sequenceReceiptDescriptor,
} from "./operator-sequence-run.js";
import {
  campaignFailureReceipt,
  campaignReceiptDescriptor,
  executeCampaignCommand,
  isCampaignCommand,
} from "./operator-campaign-run.js";
import {
  executeSegmentCommand,
  isSegmentCommand,
  segmentFailureReceipt,
  segmentReceiptDescriptor,
} from "./operator-segment-run.js";
import { runBroadcastCanary } from "./operator-broadcast-canary.js";
import { createCoreRequester } from "./operator-core-request.js";
import { createCanonicalBroadcastClient } from "./operator-broadcast-canonical-send.js";
import { createBroadcastDraftLifecycleClient } from "./operator-broadcast-draft-lifecycle-client.js";
import { sendPrepared } from "./operator-broadcast-paved.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorReceiptResult,
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
    if (
      command.kind === "broadcast_canonical_send" ||
      command.kind === "broadcast_canonical_status" ||
      command.kind === "broadcast_canonical_control"
    ) {
      const request = createCoreRequester({
        coreApiBaseUrl: config.coreApiBaseUrl,
        bearer,
        fetch: dependencies.fetch as typeof fetch,
        signal: dependencies.signal,
      });
      const canonical = createCanonicalBroadcastClient(request);
      if (command.kind === "broadcast_canonical_send") {
        return sendPrepared(command.sendInput, {
          draftLifecycle: async () =>
            createBroadcastDraftLifecycleClient(request),
          canonical: async () => canonical,
        });
      }
      if (command.kind === "broadcast_canonical_control") {
        const operation = await canonical.control(command);
        return currentReceipt(
          command,
          {
            kind: "executable_broadcast_operation",
            status: "accepted",
            operation,
          },
          operation.phase === "complete" || operation.phase === "ended"
            ? "terminal"
            : operation.phase === "paused"
              ? "blocked"
              : "queued",
          `broadcast_send_${operation.phase}`,
          "controlled",
        );
      }
      const operation = await canonical.read({
        workspace: command.workspace,
        draftId: command.draftId,
      });
      return {
        schema_version: "fonte.cli.operator_receipt.v1",
        command: command.kind,
        outcome:
          operation === null
            ? "completed"
            : operation.phase === "complete" || operation.phase === "ended"
              ? "terminal"
              : operation.phase === "paused"
                ? "blocked"
                : "queued",
        reason:
          operation === null
            ? "broadcast_send_operation_absent"
            : `broadcast_send_${operation.phase}`,
        workspace: command.workspace,
        authority: {
          status: "current",
          contract_id: "fonte.core.broadcast_send",
        },
        core_effect: "none",
        result:
          operation === null
            ? null
            : {
                kind: "executable_broadcast_operation",
                status: "accepted",
                operation,
              },
      };
    }
    const client = createCoreOperatorClient({
      coreApiBaseUrl: config.coreApiBaseUrl,
      bearer,
      fetch: dependencies.fetch as typeof fetch,
      signal: dependencies.signal,
    });
    if (isCampaignCommand(command)) {
      const result = await executeCampaignCommand(
        command,
        client.campaignMetadata,
      );
      const descriptor = campaignReceiptDescriptor(command, result);
      return currentReceipt(
        command,
        result,
        descriptor.outcome,
        descriptor.reason,
        descriptor.coreEffect,
      );
    }
    if (isSegmentCommand(command)) {
      const result = await executeSegmentCommand(
        command,
        client.segmentMetadata,
      );
      const descriptor = segmentReceiptDescriptor(command, result);
      return currentReceipt(
        command,
        result,
        descriptor.outcome,
        descriptor.reason,
        descriptor.coreEffect,
      );
    }
    const result = await execute(command, client, dependencies.sleep);
    return successReceipt(command, result);
  } catch (error) {
    const core = error instanceof CoreOperatorError ? error : null;
    if (isCampaignCommand(command))
      return campaignFailureReceipt(command, error);
    if (isSegmentCommand(command)) return segmentFailureReceipt(command, error);
    return withAmbiguousSequenceRecovery(
      command,
      withAmbiguousBroadcastRecovery<OperatorReceipt>(command, {
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
      }),
    );
  }
}
async function execute(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  client: ReturnType<typeof createCoreOperatorClient>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OperatorResult> {
  const marketingSettings = executeWorkspaceMarketingSettingsCommand(
    command,
    client,
  );
  if (marketingSettings) return marketingSettings;
  if (isBroadcastSendInstructionCommand(command)) {
    return executeBroadcastSendInstructionCommand(command, client, sleep);
  }
  if (isSequenceCommand(command))
    return executeSequenceCommand(command, client);
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
  if (command.kind === "bridge_contact_import_status")
    return client.readContactImportStatus({
      workspace: command.workspace,
      environment: command.environment,
      contactImportBatchId: command.contactImportBatchId,
    });
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
  if (result.kind === "broadcast_send_operation") {
    const send = broadcastSendInstructionReceiptDescriptor(command, result);
    if (!send) throw new TypeError("operator_receipt_unmappable");
    return currentReceipt(
      command,
      result,
      send.outcome,
      send.reason,
      send.coreEffect,
    );
  }
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
  const sequence = sequenceReceiptDescriptor(command, result);
  if (sequence) {
    return currentReceipt(
      command,
      result,
      sequence.outcome,
      sequence.reason,
      sequence.coreEffect,
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
  const marketingSettings = workspaceMarketingSettingsReceiptDescriptor(
    command,
    result,
  );
  if (marketingSettings) {
    return currentReceipt(
      marketingSettings.command,
      marketingSettings.result,
      "completed",
      "workspace_marketing_settings_read",
      "none",
    );
  }
  if (result.kind === "contact_import_status")
    return currentReceipt(
      command,
      result,
      "completed",
      "contact_import_status_completed",
      "none",
    );
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
  result: OperatorReceiptResult,
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
      command.kind === "broadcast_canonical_send" ||
      command.kind === "broadcast_canonical_status" ||
      command.kind === "broadcast_canonical_control"
        ? "fonte.core.broadcast_send"
        : command.kind.startsWith("campaign_")
          ? "fonte.core.campaign_configuration.v1"
          : command.kind.startsWith("segment_")
            ? "fonte.core.native_segment.v1"
            : command.kind.startsWith("broadcast_send_") ||
                command.kind === "broadcast_schedule" ||
                command.kind === "broadcast_schedule_replace" ||
                command.kind === "broadcast_spend_limit_increase"
              ? "fonte.core.broadcast_send_instruction.v3"
              : command.kind === "sequence_activate"
                ? "fonte.core.sequence_activation.v1"
                : command.kind.startsWith("sequence_")
                  ? "fonte.core.sequence_authoring.v1"
                  : command.kind === "workspace_marketing_settings_read"
                    ? "fonte.core.workspace_marketing_settings.v1"
                    : command.kind === "broadcast_preflight"
                      ? "fonte.core.broadcast_preflight.v1"
                      : command.kind === "broadcast_audience_append"
                        ? "fonte.core.production_broadcast_audience_append.v1"
                        : command.kind.startsWith("broadcast_") &&
                            command.kind !== "broadcast_test_send" &&
                            command.kind !== "broadcast_test_status"
                          ? "fonte.core.production_broadcast.v1"
                          : command.kind === "bridge_contact_import_status"
                            ? "fonte.core.contact_import.v1"
                            : "fonte.core.sandbox_canary.v1",
  };
}
