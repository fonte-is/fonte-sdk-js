import type { CoreOperatorClient } from "./operator-client.js";
import type {
  ProviderAudienceFreezeResult,
  ProviderAudienceReconciliationResult,
  ProviderCollectionListResult,
} from "./operator-provider-audience-types.js";
import type { OperatorCommand, OperatorResult } from "./operator-types.js";

type ProviderAudienceResult =
  | ProviderCollectionListResult
  | ProviderAudienceReconciliationResult
  | ProviderAudienceFreezeResult;

export function executeProviderAudienceCommand(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  client: CoreOperatorClient,
): Promise<ProviderAudienceResult> | null {
  if (command.kind === "bridge_provider_collections") {
    return client.listProviderCollections(command);
  }
  if (command.kind === "bridge_provider_reconcile") {
    return client.reconcileProviderAudience(command);
  }
  if (command.kind === "bridge_provider_freeze") {
    return client.freezeProviderAudience(command);
  }
  return null;
}

export function providerAudienceReceiptDescriptor(result: OperatorResult): {
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect: "none" | "created";
} | null {
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
