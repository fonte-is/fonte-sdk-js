import type { CoreOperatorClient } from "./operator-client.js";
import type {
  ContactImportStatusResult,
  ProviderAudienceFreezeResult,
  ProviderAudienceReconciliationResult,
  ProviderCollectionListResult,
} from "./operator-provider-audience-types.js";
import type { ProviderRotationResult } from "./operator-provider-rotation-types.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
} from "./operator-types.js";

type ProviderAudienceResult =
  | ContactImportStatusResult
  | ProviderCollectionListResult
  | ProviderAudienceReconciliationResult
  | ProviderAudienceFreezeResult
  | ProviderRotationResult;

export function executeProviderAudienceCommand(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  client: CoreOperatorClient,
): Promise<ProviderAudienceResult> | null {
  if (command.kind === "bridge_contact_import_status") {
    return client.readContactImportStatus(command);
  }
  if (command.kind === "bridge_provider_collections") {
    return client.listProviderCollections(command);
  }
  if (command.kind === "bridge_provider_reconcile") {
    return client.reconcileProviderAudience(command);
  }
  if (command.kind === "bridge_provider_freeze") {
    return client.freezeProviderAudience(command);
  }
  if (command.kind === "bridge_provider_rotation_start") {
    return client.startProviderRotation(command);
  }
  if (command.kind === "bridge_provider_rotation_advance") {
    return client.advanceProviderRotation(command);
  }
  if (command.kind === "bridge_provider_rotation_read") {
    return client.readProviderRotation(command);
  }
  if (command.kind === "bridge_provider_rotation_seal") {
    return client.sealProviderRotation(command);
  }
  return null;
}

export function providerAudienceReceiptDescriptor(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
): {
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect: OperatorReceipt["core_effect"];
} | null {
  if (result.kind === "provider_rotation_partition") {
    const blocked =
      result.status === "blocked_unknown" ||
      result.status === "population_changed";
    return {
      outcome: blocked ? "blocked" : "completed",
      reason: `provider_rotation_partition_${result.status}`,
      coreEffect:
        command.kind === "bridge_provider_rotation_read" ? "none" : "attempted",
    };
  }
  if (result.kind === "contact_import_status") {
    return {
      outcome: "completed",
      reason: "contact_import_status_completed",
      coreEffect: "none",
    };
  }
  if (result.kind === "provider_collections") {
    return {
      outcome: "completed",
      reason: "provider_collections_complete",
      coreEffect: "none",
    };
  }
  if (result.kind === "provider_audience_reconciliation") {
    return {
      outcome: result.ready ? "completed" : "blocked",
      reason: result.ready
        ? "provider_audience_reconciliation_ready"
        : "provider_audience_reconciliation_unavailable",
      coreEffect: "none",
    };
  }
  if (result.kind === "provider_audience_freeze") {
    return {
      outcome: "completed",
      reason: result.created
        ? "provider_audience_freeze_created"
        : "provider_audience_freeze_idempotent",
      coreEffect: result.created ? "created" : "none",
    };
  }
  return null;
}
