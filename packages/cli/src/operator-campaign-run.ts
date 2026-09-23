import { CoreOperatorError } from "./operator-core-request.js";
import type { CampaignMetadataClient } from "./operator-campaign-client.js";
import type {
  CampaignCommandEnvelope,
  CampaignMetadataEnvelope,
  CampaignOperatorCommand,
  CampaignOperatorReceipt,
} from "./operator-campaign-types.js";

export interface CampaignReceiptDescriptor {
  readonly outcome: "completed";
  readonly reason: "ok";
  readonly coreEffect: "none" | "created" | "replaced";
}

export function isCampaignCommand(command: {
  readonly kind: string;
}): command is CampaignOperatorCommand {
  return command.kind.startsWith("campaign_");
}

export async function executeCampaignCommand(
  command: CampaignOperatorCommand,
  client: CampaignMetadataClient,
): Promise<CampaignMetadataEnvelope> {
  switch (command.kind) {
    case "campaign_list":
      return client.list(command);
    case "campaign_read":
      return client.read(command);
    case "campaign_create":
      return client.create(command);
    case "campaign_update":
      return client.update(command);
    case "campaign_receipt":
      return client.readCommand(command);
  }
}

export async function runCampaignOperatorCommand(
  command: CampaignOperatorCommand,
  client: CampaignMetadataClient,
): Promise<CampaignOperatorReceipt> {
  try {
    const result = await executeCampaignCommand(command, client);
    const descriptor = campaignReceiptDescriptor(command, result);
    return {
      schema_version: "fonte.cli.operator_receipt.v1",
      command: command.kind,
      outcome: descriptor.outcome,
      reason: descriptor.reason,
      workspace: command.workspace,
      authority: {
        status: "current",
        contract_id: "fonte.core.campaign_configuration.v1",
      },
      core_effect: descriptor.coreEffect,
      result,
    };
  } catch (error) {
    return campaignFailureReceipt(command, error);
  }
}

export function campaignFailureReceipt(
  command: CampaignOperatorCommand,
  error: unknown,
): CampaignOperatorReceipt {
  const core = error instanceof CoreOperatorError ? error : null;
  const operation =
    command.kind === "campaign_create" || command.kind === "campaign_update";
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome: "blocked",
    reason: sanitizedReason(core?.reason),
    workspace: command.workspace,
    authority: {
      status: "current",
      contract_id: "fonte.core.campaign_configuration.v1",
    },
    core_effect: core?.coreEffect ?? "none",
    ...(operation && core?.coreEffect === "unknown"
      ? {
          next_action: {
            kind: "read_campaign_command" as const,
            workspace: command.workspace,
            environment: command.environment,
            operation_id: command.operationId,
            resource_id: command.campaignId,
          },
        }
      : {}),
    result: null,
  };
}

export function campaignReceiptDescriptor(
  command: CampaignOperatorCommand,
  result: CampaignMetadataEnvelope,
): CampaignReceiptDescriptor {
  if (
    command.kind === "campaign_create" ||
    command.kind === "campaign_update"
  ) {
    const mutation = result as CampaignCommandEnvelope;
    if (mutation.replayed)
      return { outcome: "completed", reason: "ok", coreEffect: "none" };
    return {
      outcome: "completed",
      reason: "ok",
      coreEffect: command.kind === "campaign_create" ? "created" : "replaced",
    };
  }
  return { outcome: "completed", reason: "ok", coreEffect: "none" };
}

function sanitizedReason(reason: string | undefined): string {
  return reason && /^[a-z0-9_]{1,100}$/u.test(reason)
    ? reason
    : "operator_request_failed";
}
