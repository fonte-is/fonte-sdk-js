import { renderProductionOperatorHuman } from "./operator-production-render.js";
import type {
  ProviderAudienceUnavailableInputResult as UnavailableInput,
  ProviderAudienceSourceReferenceResult,
  ProviderAudienceReconciliationResult,
} from "./operator-provider-audience-types.js";
import type { OperatorReceipt } from "./operator-types.js";

export function renderOperatorJson(receipt: OperatorReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

export function renderOperatorHuman(receipt: OperatorReceipt): string {
  if (receipt.outcome === "unsupported_authority") {
    return "Fonte operation unavailable: unsupported_authority.\nCore effect: none.\n";
  }
  if (receipt.outcome === "blocked" && receipt.result === null) {
    return renderBlocked(receipt);
  }
  const production = renderProductionOperatorHuman(receipt);
  if (production !== null) return production;
  const result = receipt.result!;
  if (result.kind === "contact_import_status") {
    return [
      "Fonte Contact import: completed.",
      `Contact import batch: ${result.contact_import_batch_id}.`,
      `Identity set SHA-256: ${result.identity_set_sha256}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "resend_bridge_preview") {
    return [
      `Fonte Resend Bridge preview: ${result.pagination.status}.`,
      `Connection: ${result.connection_id}.`,
      `Segment: ${result.segment.name} (${result.segment.id}).`,
      `Observed/protected/unknown contacts: ${result.contacts_observed}/${result.protected.contacts}/${result.unknown.contacts}.`,
      `Pages: contacts ${coverage(result.pagination.contacts)}, suppressions ${coverage(result.pagination.suppressions)}.`,
      `Fingerprint: ${result.observation_fingerprint}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "resend_bridge_copy") {
    const reconciliation = result.reconciliation;
    return [
      `Fonte Resend Bridge copy: ${result.import_receipt.created ? "completed" : "idempotent"}.`,
      `Import receipt: ${result.import_receipt.contact_import_batch_id}.`,
      `Accepted/created/updated/unchanged: ${reconciliation.accepted}/${reconciliation.created}/${reconciliation.updated ?? "unknown"}/${reconciliation.unchanged ?? "unknown"}.`,
      `Protected/conflict/unknown: ${reconciliation.protected}/${reconciliation.conflict ?? "unknown"}/${reconciliation.unknown}.`,
      `Fingerprint: ${result.observation_fingerprint}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result.kind === "provider_collections") {
    return [
      "Fonte Bridge collections: complete.",
      `Provider/connection: ${result.provider}/${result.connection_id}.`,
      `Observed: ${result.observed_at}; coverage: ${result.completeness}.`,
      `Collections (${result.collections.length}):`,
      ...(result.collections.length === 0
        ? ["- none"]
        : result.collections.map(
            (item) => `- ${item.display_name} (${item.collection_id})`,
          )),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "provider_audience_reconciliation") {
    return renderProviderAudienceReconciliation(result);
  }
  if (result.kind === "provider_audience_freeze") {
    return [
      `Fonte Bridge audience freeze: ${result.created ? "created" : "idempotent"}.`,
      `Frozen audience: ${result.frozen_audience_id}.`,
      `Label: ${result.label}.`,
      `Source/excluded/protected/unknown/final: ${audienceCounts(result.counts)}.`,
      `Fingerprint: ${result.observation_fingerprint}.`,
      `Recipient import batch: ${result.contact_import_batch_id}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result.kind === "provider_connections") {
    return [
      `Fonte ${providerName(result.provider)} connections (${result.connections.length}):`,
      ...(result.connections.length === 0
        ? ["- none"]
        : result.connections.map(
            (connection) =>
              `- ${connection.display_name} (${connection.connection_id}); version ${connection.credential_version}; ${connection.status}.`,
          )),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "provider_connection_oauth") {
    return [
      `Fonte ${providerName(result.provider)} connection: ${result.status}.`,
      `Reason: ${result.reason}.`,
      ...(result.provider === "resend"
        ? [
            "Provider scope: full_access; Fonte uses it for read-only Bridge operations.",
          ]
        : []),
      ...(result.authorization_url
        ? [`Authorize in your browser: ${result.authorization_url}`]
        : []),
      ...(result.connection
        ? [`Connection: ${result.connection.connection_id}.`]
        : [`Connection: ${result.connection_id}.`]),
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result.kind !== "sandbox_test") {
    throw new TypeError("operator_receipt_unrenderable");
  }
  return [
    `Fonte sandbox test: ${result.status}.`,
    `Accepted/refused/unknown: ${counts(result)}.`,
    `Accepted email usage: ${result.accepted_email_usage_quantity ?? "pending"}.`,
    "Recipient: signed-in account's verified email (address withheld).",
    "",
  ].join("\n");
}

function providerName(provider: "resend" | "kit"): "Resend" | "Kit" {
  return provider === "resend" ? "Resend" : "Kit";
}

function renderBlocked(receipt: OperatorReceipt): string {
  if (receipt.reason === "resend_bridge_unavailable") {
    return [
      "Fonte Resend Bridge could not continue.",
      "Core returned 503: Resend Bridge credential custody is unavailable.",
      `Reason: ${receipt.reason}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (receipt.reason === "provider_collection_discovery_unavailable") {
    return [
      "Fonte Bridge collection discovery could not continue.",
      "Core returned 503: provider collection discovery or credential custody is unavailable.",
      `Reason: ${receipt.reason}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  return [
    receipt.command.startsWith("bridge_")
      ? "Fonte Bridge operation could not continue."
      : receipt.command === "broadcast_preflight"
        ? "Fonte broadcast preflight could not be observed."
        : receipt.command === "broadcast_test_send" ||
            receipt.command === "broadcast_test_status"
          ? "Fonte sandbox test could not continue."
          : "Fonte production broadcast operation could not continue.",
    ...(receipt.command === "broadcast_preflight"
      ? ["Readiness: unknown."]
      : []),
    `Reason: ${receipt.reason}.`,
    `Core effect: ${receipt.core_effect}.`,
    "",
  ].join("\n");
}

function renderProviderAudienceReconciliation(
  result: ProviderAudienceReconciliationResult,
): string {
  return [
    `Fonte Bridge audience reconciliation: ${result.ready ? "ready" : "unavailable"}.`,
    `Source: ${result.source ? referenceLabel(result.source.reference) : "unavailable"}.`,
    `Exclusions (${result.exclusions.length}):`,
    ...(result.exclusions.length === 0
      ? ["- none"]
      : result.exclusions.map(
          (item) =>
            `- ${item.index}: ${referenceLabel(item.reference)}; overlap ${item.overlap_count ?? "unknown"}.`,
        )),
    ...(result.counts
      ? [
          `Source/excluded/protected/unknown/final: ${audienceCounts(result.counts)}.`,
        ]
      : ["Counts: unavailable."]),
    `Fingerprint: ${result.observation_fingerprint ?? "unavailable"}.`,
    ...(result.unavailable_inputs.length === 0
      ? []
      : [
          "Unavailable inputs:",
          ...result.unavailable_inputs.map(
            (item) =>
              `- ${item.role}${item.index === null ? "" : ` ${item.index}`}: ${item.reason}; ${referenceLabel(item.reference)}${unavailableDiagnostics(item)}.`,
          ),
        ]),
    "Core effect: none.",
    "",
  ].join("\n");
}

function unavailableDiagnostics(item: UnavailableInput): string {
  const fields = Object.entries({
    provider_response_invalid_stage: item.provider_response_invalid_stage,
    provider_response_invalid_reason: item.provider_response_invalid_reason,
    provider_unavailable_stage: item.provider_unavailable_stage,
    provider_unavailable_reason: item.provider_unavailable_reason,
  }).flatMap(([key, value]) => (value ? [`${key}=${value}`] : []));
  return fields.length === 0 ? "" : `; ${fields.join("; ")}`;
}

function referenceLabel(value: ProviderAudienceSourceReferenceResult): string {
  if ("kind" in value) {
    return `Fonte audience ${value.contact_import_batch_id} (${value.identity_set_sha256})`;
  }
  return `${value.provider}/${value.connection_id}/${value.collection_type}/${value.display_name} (${value.collection_id})`;
}

function audienceCounts(value: {
  readonly source: number;
  readonly exclusion_union: number;
  readonly protected: number;
  readonly unknown: number;
  readonly final: number;
}): string {
  return [
    value.source,
    value.exclusion_union,
    value.protected,
    value.unknown,
    value.final,
  ].join("/");
}

function counts(result: NonNullable<OperatorReceipt["result"]>): string {
  if (result.kind !== "sandbox_test") return "unavailable";
  return [result.accepted_count, result.refused_count, result.unknown_count]
    .map((value) => value ?? "pending")
    .join("/");
}

function coverage(value: {
  readonly status: "complete" | "partial";
  readonly pages_observed: number;
  readonly has_more: boolean;
}): string {
  return `${value.pages_observed} (${value.status}${value.has_more ? ", more available" : ""})`;
}
