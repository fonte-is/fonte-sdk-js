import type { OperatorReceipt } from "./operator-types.js";

export function renderProductionOperatorHuman(
  receipt: OperatorReceipt,
): string | null {
  const result = receipt.result;
  if (result?.kind === "broadcast_preflight") return renderPreflight(result);
  if (result?.kind === "broadcast_draft") {
    return [
      `Fonte broadcast draft: ${result.outcome ?? "observed"}.`,
      `Draft/version: ${result.draft_id}/${result.version}.`,
      `Title: ${result.title}.`,
      `Subject: ${result.subject}.`,
      `Purpose: ${result.communication_purpose_name} (${result.communication_purpose_id}).`,
      `Audience: ${result.audience_kind}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_audience_options") {
    return [
      `Fonte audience options: ${result.communication_purposes.length} purposes, ${result.sources.length} factual sources.`,
      ...result.communication_purposes.map(
        (item) => `Purpose: ${item.label} (${item.communication_purpose_id}).`,
      ),
      ...result.sources.map(sourceLine),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_audience_preview") {
    return [
      `Fonte audience preview: ${result.draft_id}.`,
      `Matched/protected/excluded/unknown/final eligible: ${result.counts.matched}/${result.counts.ineligible_protected}/${result.counts.excluded}/${result.counts.unknown}/${result.counts.final_eligible}.`,
      `Purpose: ${result.communication_purpose_name ?? "unknown"} (${result.communication_purpose_id ?? "unknown"}).`,
      ...result.source_provenance.map(sourceLine),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_audience_append") {
    return [
      `Fonte broadcast audience append: ${result.replayed ? "idempotent" : "completed"}.`,
      `Broadcast/authorization: ${result.broadcast_id}/${result.append_authorization_id}.`,
      `Accepted baseline/target/final: ${result.baseline.accepted_recipient_count}/${result.accepted_target_ceiling}/${result.aggregate.accepted_recipient_count}.`,
      `Segments: ${result.aggregate.segment_count}.`,
      ...result.segments.map(
        (segment) =>
          `- ${segment.index}: ${segment.frozen_audience_id}; ${segment.identity_set_sha256}; accepted ${segment.accepted_recipient_count}${segment.source_provenance ? `; source ${segment.source_provenance.provider}/${segment.source_provenance.collection_type}/${segment.source_provenance.collection_id}` : ""}.`,
      ),
      `Idempotency key: ${result.idempotency_key}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (
    result?.kind === "broadcast_test_queued" ||
    result?.kind === "broadcast_authorization"
  ) {
    return renderQueued(receipt, result);
  }
  if (result?.kind === "production_test") {
    return [
      `Fonte verified-account test: ${result.status}.`,
      `Accepted/refused/unknown: ${result.accepted_count}/${result.refused_count}/${result.unknown_count}.`,
      `Accepted email usage: ${result.accepted_email_usage_quantity}.`,
      "Recipient: signed-in account's verified email (address withheld).",
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_progress") {
    return [
      `Fonte broadcast progress: ${result.status}.`,
      `Broadcast/version: ${result.broadcast_id}/${result.progress_version}.`,
      `Pending/claimed/accepted/refused/unknown/cancelled: ${result.pending_recipient_count}/${result.claimed_recipient_count}/${result.accepted_recipient_count}/${result.refused_recipient_count}/${result.unknown_recipient_count}/${result.cancelled_recipient_count}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_canary") {
    const final = result.final;
    return [
      `Fonte broadcast canary: ${receipt.outcome}.`,
      `Operation/broadcast: ${result.operation_id}/${result.broadcast_id}.`,
      `Cumulative release ceiling: ${result.release_ceiling}.`,
      `Accepted/refused/unknown/cancelled: ${final?.accepted_recipient_count ?? "unavailable"}/${final?.refused_recipient_count ?? "unavailable"}/${final?.unknown_recipient_count ?? "unavailable"}/${final?.cancelled_recipient_count ?? "unavailable"}.`,
      `Control state: ${final?.control_state ?? "unavailable"}.`,
      `Authorization: ${result.authorization.status}; bearer persisted: no.`,
      `Reason: ${receipt.reason}.`,
      "",
    ].join("\n");
  }
  if (result?.kind === "broadcast_result") return renderResult(result);
  return null;
}

function renderPreflight(
  result: Extract<
    NonNullable<OperatorReceipt["result"]>,
    { readonly kind: "broadcast_preflight" }
  >,
): string {
  return [
    `Fonte broadcast preflight: ${result.ready ? "ready" : "blocked"}.`,
    `Draft version requested/confirmed: ${result.requested_draft_version}/${result.confirmed_draft_version ?? "unknown"}.`,
    result.blockers.length === 0
      ? "Blockers: none."
      : `Blockers (${result.blockers.length}):`,
    ...result.blockers.map(({ authority, code }) => `- ${authority}: ${code}`),
    ...(result.checks.audience_reuse.evidence?.override_required
      ? [
          `Audience reuse identity: ${result.checks.audience_reuse.evidence.identity.digest}.`,
        ]
      : []),
    "Core effect: none.",
    "",
  ].join("\n");
}

function renderQueued(
  receipt: OperatorReceipt,
  result: Extract<
    NonNullable<OperatorReceipt["result"]>,
    { readonly kind: "broadcast_test_queued" | "broadcast_authorization" }
  >,
): string {
  return [
    `${result.kind === "broadcast_test_queued" ? "Fonte verified-account test" : "Fonte production broadcast"}: ${result.replayed ? "idempotent" : "queued"}.`,
    `Draft/broadcast: ${result.draft_id}/${result.broadcast_id}.`,
    `Requested/eligible/refused/unknown: ${result.requested_recipient_count}/${result.eligible_recipient_count}/${result.refused_recipient_count}/${result.unknown_recipient_count}.`,
    "Lost responses remain unknown until authoritative readback.",
    `Core effect: ${receipt.core_effect}.`,
    "",
  ].join("\n");
}

function renderResult(
  result: Extract<
    NonNullable<OperatorReceipt["result"]>,
    { readonly kind: "broadcast_result" }
  >,
): string {
  return [
    `Fonte broadcast result: ${result.status}.`,
    `Draft/broadcast: ${result.draft_id}/${result.broadcast_id}.`,
    `Accepted/refused/unknown/pending/claimed/cancelled: ${result.accepted_recipient_count}/${result.refused_recipient_count}/${result.unknown_recipient_count}/${result.pending_recipient_count}/${result.claimed_recipient_count}/${result.cancelled_recipient_count}.`,
    `Delivered: ${result.delivered_count}.`,
    ...(result.audience_targeting
      ? [
          `Purpose: ${result.audience_targeting.communication_purpose_name} (${result.audience_targeting.communication_purpose_id}).`,
          `Audience: ${result.audience_targeting.audience_kind}.`,
          ...result.audience_targeting.source_provenance.map(sourceLine),
        ]
      : ["Audience provenance: unavailable (legacy result)."]),
    "",
  ].join("\n");
}

function sourceLine(value: {
  readonly kind: "collection" | "import_batch";
  readonly label: string | null;
  readonly collection_id?: string;
  readonly contact_import_batch_id?: string;
}): string {
  const id =
    value.kind === "collection"
      ? value.collection_id
      : value.contact_import_batch_id;
  return `Source: ${value.kind} ${value.label ?? "unlabeled"} (${id}).`;
}
