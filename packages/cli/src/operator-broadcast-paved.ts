import { createHash } from "node:crypto";

import type {
  BroadcastDraftLifecycleClient,
  BroadcastDraftLifecycleResult,
} from "./operator-broadcast-draft-lifecycle-client.js";
import type {
  BroadcastDraftRevisionChanges,
  BroadcastDraftRevisionClient,
} from "./operator-broadcast-draft-revision-client.js";
import type { BroadcastDraftSnapshot } from "./operator-broadcast-draft-snapshot.js";
import type {
  BroadcastRenderTestClient,
} from "./operator-broadcast-render-test-client.js";
import type {
  BroadcastSendInstructionClient,
} from "./operator-broadcast-send-instruction-client.js";
import type { BroadcastSendOperationResult } from "./operator-broadcast-send-instruction-types.js";
import type {
  BroadcastSenderClient,
  BroadcastSenderProfile,
} from "./operator-broadcast-sender-client.js";
import {
  parseBroadcastRecipientSelection,
  sameBroadcastRecipientSelection,
  type BroadcastRecipientSelection,
} from "./operator-broadcast-targeting-selection.js";
import type { BroadcastTargetingClient } from "./operator-broadcast-targeting-client.js";
import { CoreOperatorError } from "./operator-core-request.js";
import {
  prepareBroadcastHtmlSource,
  type BroadcastHtmlSource,
} from "./operator-broadcast-html-source.js";
import {
  BroadcastLocalFileError,
  type BroadcastLocalFileReader,
} from "./operator-broadcast-html-file.js";
import {
  BROADCAST_RECIPIENT_SET_MAX_BYTES,
  BroadcastRecipientSetFileError,
  type BroadcastRecipientSetClient,
  type BroadcastRecipientSetResult,
} from "./operator-broadcast-recipient-set-client.js";
import { broadcastSendInstructionReceiptDescriptor } from "./operator-broadcast-send-instruction-run.js";
import type {
  OperatorCommand,
  OperatorReceipt,
} from "./operator-types.js";
import { preflightRecipientExpression } from "./operator-preflight-audience-json.js";
import type { ProductionDraftClient } from "./operator-production-draft-client.js";
import type { ProductionAudienceOptionsResult } from "./operator-production-types.js";
import type {
  WorkspaceCatalogClient,
  WorkspaceSummary,
} from "./operator-workspace-catalog-client.js";

export interface BroadcastPavedRequest {
  readonly workspace_selector?: string;
  readonly environment?: "sandbox" | "production";
  readonly draft_id?: string;
  readonly create_new?: boolean;
  readonly title?: string | null;
  readonly subject?: string | null;
  readonly preheader?: string | null;
  readonly text_source?: string | null;
  readonly audience_file?: string;
  readonly html_source_file?: string;
  readonly html_reference_file?: string | null;
  readonly postal_address_literal?: string | null;
  readonly literal_fallbacks?: Readonly<Record<string, string>>;
  readonly sender_selector?: string;
  readonly audience_selector?: string;
  readonly communication_purpose_selector?: string;
}

export interface BroadcastPavedChoice {
  readonly field: string;
  readonly value: string;
  readonly label: string;
}

export interface BroadcastPavedSendInput {
  readonly workspace: string;
  readonly draft_id: string;
  readonly expected_revision: number;
  readonly snapshot_sha256: string;
  readonly request_id: string;
}

export interface BroadcastPavedPreparationResult {
  readonly status: "ready_to_send" | "preparing" | "needs_input" | "blocked";
  readonly draft_id: string | null;
  readonly revision: number | null;
  readonly summary: string;
  readonly missing: readonly string[];
  readonly choices: readonly BroadcastPavedChoice[];
  readonly warnings: readonly string[];
  readonly send_input: BroadcastPavedSendInput | null;
}

export interface BroadcastPavedDependencies {
  readonly workspaceCatalog: () => Promise<WorkspaceCatalogClient>;
  readonly readSelectedWorkspace?: () => Promise<string | null>;
  readonly draftLifecycle: () => Promise<BroadcastDraftLifecycleClient>;
  readonly draftRevision: () => Promise<BroadcastDraftRevisionClient>;
  readonly senders: () => Promise<BroadcastSenderClient>;
  readonly targeting: () => Promise<BroadcastTargetingClient>;
  readonly productionDrafts: () => Promise<ProductionDraftClient>;
  readonly render: () => Promise<BroadcastRenderTestClient>;
  readonly send: () => Promise<BroadcastSendInstructionClient>;
  readonly recipientSetSupplier?: () => Promise<BroadcastRecipientSetClient>;
  readonly readFile: BroadcastLocalFileReader;
}

export interface BroadcastPavedOperator {
  prepare(input: BroadcastPavedRequest): Promise<BroadcastPavedPreparationResult>;
  send(input: BroadcastPavedSendInput): Promise<OperatorReceipt>;
}

interface PreparationContext {
  draftId: string | null;
  revision: number | null;
  oneTimeSetId?: string;
  readonly warnings: string[];
}

interface RevisionedDraft {
  readonly draft_id: string;
  readonly revision: number;
  readonly draft: BroadcastDraftSnapshot;
}

type Resolution<T> =
  | { readonly kind: "selected"; readonly value: T }
  | {
      readonly kind: "needs_input";
      readonly missing: readonly string[];
      readonly choices: readonly BroadcastPavedChoice[];
      readonly summary: string;
    }
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly warnings: readonly string[];
    };

const ALL_CONTACTS_SELECTION: BroadcastRecipientSelection = {
  to: { kind: "everyone" },
  except: [],
};
const MAX_RECIPIENT_SET_READ_ATTEMPTS = 3;

export function createBroadcastPavedOperator(
  dependencies: BroadcastPavedDependencies,
): BroadcastPavedOperator {
  return {
    async prepare(input) {
      const context: PreparationContext = {
        draftId: null,
        revision: null,
        warnings: [],
      };
      try {
        if (input.draft_id && input.create_new === true) {
          return blocked(context, "Choose one draft: an existing draft or create-new intent.", [
            "draft_identity_conflict",
          ]);
        }
        if (!input.draft_id && input.create_new !== true) {
          return needsInput(context, {
            missing: ["draft_id_or_create_new"],
            choices: [
              {
                field: "create_new",
                value: "true",
                label: "Create one new draft",
              },
            ],
            summary: "Select an existing draft or explicitly request one new draft.",
          });
        }

        const workspaceResolution = await resolveWorkspace(
          input.workspace_selector,
          input.environment,
          await (await dependencies.workspaceCatalog()).listWorkspaces(),
          input.workspace_selector === undefined
            ? await dependencies.readSelectedWorkspace?.()
            : null,
        );
        if (workspaceResolution.kind === "needs_input") {
          return needsInput(context, workspaceResolution);
        }
        if (workspaceResolution.kind === "blocked") {
          return blocked(context, workspaceResolution.reason, workspaceResolution.warnings);
        }
        const { workspace } = workspaceResolution.value;
        if (workspace.role === "viewer") {
          return blocked(context, "The selected workspace role cannot prepare or Send Broadcasts.", [
            "workspace_role_read_only",
          ]);
        }

        if (input.create_new === true) {
          return await prepareNewDraft(
            input,
            workspace,
            context,
            dependencies,
          );
        }
        return await prepareExistingDraft(
          input,
          workspace,
          context,
          dependencies,
        );
      } catch (error) {
        return blocked(context, "Preparation stopped before readiness was established.", [
          safeReason(error),
          ...(isUnknownEffect(error)
            ? ["A mutation outcome was uncertain; no Send or Test Send was attempted."]
            : []),
        ]);
      }
    },

    async send(input) {
      return sendPrepared(input, dependencies);
    },
  };
}

async function prepareNewDraft(
  input: BroadcastPavedRequest,
  workspace: WorkspaceSummary,
  context: PreparationContext,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastPavedPreparationResult> {
  if (!hasText(input.title)) {
    return needsInput(context, {
      missing: ["title"],
      choices: [],
      summary: "A title is required to create one Broadcast draft.",
    });
  }
  if (!hasText(input.subject)) {
    return needsInput(context, {
      missing: ["subject"],
      choices: [],
      summary: "A subject is required to create one Broadcast draft.",
    });
  }
  if (input.html_source_file && input.text_source !== undefined && input.text_source !== null) {
    return blocked(context, "Choose one content source for a new draft.", [
      "broadcast_content_source_conflict",
    ]);
  }
  if (!input.html_source_file && !hasText(input.text_source)) {
    return needsInput(context, {
      missing: ["html_source_file_or_text_source"],
      choices: [],
      summary: "Provide HTML source or non-empty text before creating the draft.",
    });
  }

  const draftId = deterministicUuid("broadcast-paved-create-v1", {
    workspace: workspace.slug,
    title: input.title,
    subject: input.subject,
  });
  context.draftId = draftId;
  const lifecycle = await dependencies.draftLifecycle();
  const existing = await readDraftIfExists(lifecycle, workspace.slug, draftId);
  if (existing) {
    if (!sameCreatedIdentity(existing.draft, input)) {
      return blocked(context, "The deterministic create identity already belongs to different draft state.", [
        "broadcast_create_identity_conflict",
      ]);
    }
    return prepareExistingDraft(
      { ...input, draft_id: draftId, create_new: false },
      workspace,
      context,
      dependencies,
    );
  }

  const senders = await (await dependencies.senders()).listBroadcastSenders({
    workspace: workspace.slug,
    match: null,
  });
  const sender = resolveSender(senders.sender_profiles, null, input.sender_selector);
  if (sender.kind !== "selected") {
    return resolutionResult(context, sender, "A verified sender choice is required before creating the draft.");
  }

  const purposeOptions = await (
    await dependencies.productionDrafts()
  ).listProductionAudienceOptions({ workspace: workspace.slug });
  const purpose = resolvePurpose(purposeOptions, null, input.communication_purpose_selector);
  if (purpose.kind !== "selected") {
    return resolutionResult(context, purpose, "A current communication purpose is required before creating the draft.");
  }

  if (!input.audience_file && !input.audience_selector) {
    return needsInput(context, {
      missing: ["audience_selector"],
      choices: [allContactsChoice()],
      summary: "Choose an explicit supported audience before creating the draft.",
    });
  }
  if (input.audience_selector && !isAllContactsSelector(input.audience_selector)) {
    return blocked(context, "This paved path can resolve only the exact all-contacts audience definition.", [
      "broadcast_audience_selector_not_supported",
    ]);
  }

  const source = await readHtmlSource(input, dependencies.readFile, true);
  if (source && source.report.blockers.length > 0) {
    return blocked(context, "The supplied HTML source has unresolved intake blockers.", [
      ...source.report.blockers,
    ]);
  }
  if (source) context.warnings.push(...source.report.warnings);

  const body = source?.html ?? input.text_source!;
  const createInput = {
    workspace: workspace.slug,
    idempotencyKey: draftId,
    title: input.title,
    subject: input.subject,
    body,
    preheader: input.preheader ?? null,
    senderProfileId: sender.value.sender_profile_id,
    replyTo: null,
    communicationPurposeId: purpose.value.communication_purpose_id,
    audience: { kind: "all_contacts" as const, expression: null },
  };

  const productionDrafts = await dependencies.productionDrafts();
  let draft: BroadcastDraftLifecycleResult | null = null;
  try {
    await productionDrafts.createProductionDraft(createInput);
  } catch (error) {
    if (!isUnknownEffect(error)) throw error;
    context.warnings.push("Create acknowledgement was lost; the same draft identity was read once before any retry.");
    draft = await readDraftIfExists(lifecycle, workspace.slug, draftId);
    if (!draft) {
      try {
        await productionDrafts.createProductionDraft(createInput);
      } catch (retryError) {
        if (!isUnknownEffect(retryError)) throw retryError;
        draft = await readDraftIfExists(lifecycle, workspace.slug, draftId);
        if (!draft) throw retryError;
      }
    }
  }
  draft ??= await lifecycle.readBroadcastDraft({
    workspace: workspace.slug,
    draftId,
  });
  context.revision = draft.revision;
  if (!sameCreateCoreFields(draft.draft, createInput)) {
    return blocked(context, "The exact created draft readback does not match the supplied create fields.", [
      "broadcast_create_readback_mismatch",
    ]);
  }

  return prepareResolvedDraft(
    input,
    workspace,
    context,
    dependencies,
    draft,
    sender.value,
    purpose.value,
    source,
  );
}

async function prepareExistingDraft(
  input: BroadcastPavedRequest,
  workspace: WorkspaceSummary,
  context: PreparationContext,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastPavedPreparationResult> {
  const lifecycle = await dependencies.draftLifecycle();
  let draft = await lifecycle.readBroadcastDraft({
    workspace: workspace.slug,
    draftId: input.draft_id!,
  });
  context.draftId = draft.draft_id;
  context.revision = draft.revision;

  if (input.html_source_file && input.text_source !== undefined && input.text_source !== null) {
    return blocked(context, "Choose one content source for the existing draft.", [
      "broadcast_content_source_conflict",
    ]);
  }
  const source = input.html_source_file
    ? await readHtmlSource(input, dependencies.readFile, false)
    : null;
  if (source && source.report.blockers.length > 0) {
    return blocked(context, "The supplied HTML source has unresolved intake blockers.", [
      ...source.report.blockers,
    ]);
  }
  if (source) context.warnings.push(...source.report.warnings);

  const [senderCatalog, purposeOptions] = await Promise.all([
    (await dependencies.senders()).listBroadcastSenders({
      workspace: workspace.slug,
      match: null,
    }),
    (await dependencies.productionDrafts()).listProductionAudienceOptions({
      workspace: workspace.slug,
    }),
  ]);
  const sender = resolveSender(
    senderCatalog.sender_profiles,
    draft.draft.sender_profile_id,
    input.sender_selector,
  );
  if (sender.kind !== "selected") {
    return resolutionResult(context, sender, "Select one exact verified sender before preparation continues.");
  }

  if (draft.draft.communication_purpose_id === null) {
    return blocked(context, "This existing draft has no communication purpose, and the current revision supplier cannot update that field.", [
      "broadcast_purpose_revision_unsupported",
    ]);
  }
  const purpose = resolvePurpose(
    purposeOptions,
    draft.draft.communication_purpose_id,
    input.communication_purpose_selector,
  );
  if (purpose.kind !== "selected") {
    return resolutionResult(context, purpose, "The draft's current communication purpose could not be verified unambiguously.");
  }

  if (input.audience_selector && !isAllContactsSelector(input.audience_selector)) {
    return blocked(context, "This paved path cannot resolve the requested audience selector through current supported definitions.", [
      "broadcast_audience_selector_not_supported",
    ]);
  }
  const existingAudience = supportedCurrentAudience(draft.draft);
  if (!input.audience_file && !input.audience_selector && !existingAudience) {
    return needsInput(context, {
      missing: ["audience_selector"],
      choices: [allContactsChoice()],
      summary: "The draft has no supported current audience; choose an explicit audience definition.",
    });
  }

  draft = await applySuppliedDraftChanges(
    input,
    workspace.slug,
    draft,
    source,
    dependencies,
  );
  context.revision = draft.revision;

  if (draft.draft.sender_profile_id !== sender.value.sender_profile_id) {
    draft = await applySender(
      workspace.slug,
      draft,
      sender.value,
      dependencies,
    );
    context.revision = draft.revision;
  }

  if (input.audience_selector && !isCurrentAllContacts(draft.draft)) {
    draft = await applyAudience(workspace.slug, draft, dependencies);
    context.revision = draft.revision;
  }

  const csvAudience = await applyCsvAudience(
    input,
    workspace.slug,
    draft,
    context,
    dependencies,
  );
  if ("status" in csvAudience) return csvAudience;
  draft = csvAudience;

  return finishPreparation(
    input,
    workspace,
    context,
    dependencies,
    draft,
    sender.value,
    purpose.value,
  );
}

async function prepareResolvedDraft(
  input: BroadcastPavedRequest,
  workspace: WorkspaceSummary,
  context: PreparationContext,
  dependencies: BroadcastPavedDependencies,
  initialDraft: BroadcastDraftLifecycleResult,
  selectedSender: BroadcastSenderProfile,
  selectedPurpose: ProductionAudienceOptionsResult["communication_purposes"][number],
  source: BroadcastHtmlSource | null,
): Promise<BroadcastPavedPreparationResult> {
  let draft = await applySuppliedDraftChanges(
    input,
    workspace.slug,
    initialDraft,
    source,
    dependencies,
  );
  context.revision = draft.revision;
  if (draft.draft.sender_profile_id !== selectedSender.sender_profile_id) {
    draft = await applySender(
      workspace.slug,
      draft,
      selectedSender,
      dependencies,
    );
    context.revision = draft.revision;
  }
  if (input.audience_selector && !isCurrentAllContacts(draft.draft)) {
    draft = await applyAudience(workspace.slug, draft, dependencies);
    context.revision = draft.revision;
  }
  const csvAudience = await applyCsvAudience(
    input,
    workspace.slug,
    draft,
    context,
    dependencies,
  );
  if ("status" in csvAudience) return csvAudience;
  draft = csvAudience;
  if (
    draft.draft.communication_purpose_id !==
    selectedPurpose.communication_purpose_id
  ) {
    return blocked(context, "The created draft readback does not preserve the selected communication purpose.", [
      "broadcast_purpose_readback_mismatch",
    ]);
  }
  context.revision = draft.revision;
  return finishPreparation(
    input,
    workspace,
    context,
    dependencies,
    draft,
    selectedSender,
    selectedPurpose,
  );
}

async function finishPreparation(
  input: BroadcastPavedRequest,
  workspace: WorkspaceSummary,
  context: PreparationContext,
  dependencies: BroadcastPavedDependencies,
  draft: BroadcastDraftLifecycleResult,
  sender: BroadcastSenderProfile,
  purpose: ProductionAudienceOptionsResult["communication_purposes"][number],
): Promise<BroadcastPavedPreparationResult> {
  const current = await (await dependencies.draftLifecycle()).readBroadcastDraft({
    workspace: workspace.slug,
    draftId: draft.draft_id,
  });
  if (
    current.draft_id !== draft.draft_id ||
    current.revision !== draft.revision ||
    hash(stableJson(current.draft)) !== hash(stableJson(draft.draft))
  ) {
    return blocked(context, "The exact draft changed before final preparation readback.", [
      "broadcast_draft_changed_during_preparation",
    ]);
  }
  draft = current;
  context.draftId = draft.draft_id;
  context.revision = draft.revision;
  if (input.audience_file && !context.oneTimeSetId) {
    return blocked(context, "The CSV audience did not reach a completed one-time set.", [
      "broadcast_csv_audience_not_completed",
    ]);
  }
  if (
    context.oneTimeSetId &&
    !isExactOneTimeAudience(draft.draft, context.oneTimeSetId)
  ) {
    return blocked(context, "The completed CSV audience is not the exact saved To selection.", [
      "broadcast_csv_audience_readback_mismatch",
    ]);
  }
  const missing = readinessMissing(draft.draft, sender, purpose);
  if (workspace.role === "viewer") missing.push("workspace_role");
  if (missing.length > 0) {
    return needsInput(context, {
      missing,
      choices: [],
      summary: `Draft ${draft.draft_id} was read at revision ${draft.revision}; required send fields remain missing. No Send or Test Send was attempted.`,
    });
  }

  let rendered: { draft_id: string; revision: number };
  try {
    rendered = await (
      await dependencies.render()
    ).renderBroadcastDraft({
      workspace: workspace.slug,
      draftId: draft.draft_id,
      revision: draft.revision,
    });
  } catch {
    return blocked(context, "The exact prepared draft revision could not be rendered.", [
      "broadcast_render_unavailable",
    ]);
  }
  if (rendered.draft_id !== draft.draft_id || rendered.revision !== draft.revision) {
    return blocked(context, "The renderer did not confirm the exact prepared draft revision.", [
      "broadcast_render_readback_mismatch",
    ]);
  }
  const snapshotSha256 = hash(stableJson(draft.draft));
  const requestId = deterministicUuid("broadcast-paved-send-v2", {
    workspace: workspace.slug,
    draftId: draft.draft_id,
    expectedRevision: draft.revision,
    snapshotSha256,
  });
  return {
    status: "ready_to_send",
    draft_id: draft.draft_id,
    revision: draft.revision,
    summary: `Draft ${draft.draft_id} was read and rendered at revision ${draft.revision}; its current sender, audience, purpose, subject, and content satisfy the available factual readiness checks. No Send or Test Send was attempted.`,
    missing: [],
    choices: [],
    warnings: [...context.warnings],
    send_input: {
      workspace: workspace.slug,
      draft_id: draft.draft_id,
      expected_revision: draft.revision,
      snapshot_sha256: snapshotSha256,
      request_id: requestId,
    },
  };
}

async function applySuppliedDraftChanges(
  input: BroadcastPavedRequest,
  workspace: string,
  initial: BroadcastDraftLifecycleResult,
  source: BroadcastHtmlSource | null,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult> {
  const changes: BroadcastDraftRevisionChanges = {
    ...(Object.hasOwn(input, "title") ? { title: input.title! } : {}),
    ...(Object.hasOwn(input, "subject") ? { subject: input.subject! } : {}),
    ...(Object.hasOwn(input, "preheader") ? { preheader: input.preheader! } : {}),
    ...(source
      ? { activeSource: "html" as const, htmlBody: source.html }
      : Object.hasOwn(input, "text_source")
        ? { activeSource: "composer" as const, composerBody: input.text_source! }
        : {}),
  };
  if (Object.keys(changes).length === 0 || matchesChanges(initial.draft, changes)) {
    return initial;
  }
  const revision = await dependencies.draftRevision();
  return applyRevision(
    initial,
    workspace,
    changes,
    (baseRevision, operationId) =>
      revision.reviseBroadcastDraft({
        workspace,
        draftId: initial.draft_id,
        baseRevision,
        operationId,
        changes,
      }),
    (snapshot) => matchesChanges(snapshot, changes),
    dependencies,
  );
}

async function applySender(
  workspace: string,
  initial: BroadcastDraftLifecycleResult,
  sender: BroadcastSenderProfile,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult> {
  const client = await dependencies.senders();
  return applyRevision(
    initial,
    workspace,
    { sender: sender.sender_profile_id },
    (baseRevision, operationId) =>
      client.updateBroadcastSender({
        workspace,
        draftId: initial.draft_id,
        baseRevision,
        operationId,
        senderProfileId: sender.sender_profile_id,
      }),
    (snapshot) => snapshot.sender_profile_id === sender.sender_profile_id,
    dependencies,
  );
}

async function applyAudience(
  workspace: string,
  initial: BroadcastDraftLifecycleResult,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult> {
  return applyRecipientSelection(
    workspace,
    initial,
    ALL_CONTACTS_SELECTION,
    dependencies,
  );
}

async function applyRecipientSelection(
  workspace: string,
  initial: BroadcastDraftLifecycleResult,
  selection: BroadcastRecipientSelection,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult> {
  const client = await dependencies.targeting();
  return applyRevision(
    initial,
    workspace,
    { recipientSelection: selection },
    (baseRevision, operationId) =>
      client.updateBroadcastTargeting({
        workspace,
        draftId: initial.draft_id,
        baseRevision,
        operationId,
        recipientSelection: selection,
      }),
    (snapshot) => {
      try {
        return sameBroadcastRecipientSelection(
          parseBroadcastRecipientSelection(snapshot.recipient_selection),
          selection,
        );
      } catch {
        return false;
      }
    },
    dependencies,
  );
}

async function applyCsvAudience(
  input: BroadcastPavedRequest,
  workspace: string,
  draft: BroadcastDraftLifecycleResult,
  context: PreparationContext,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult | BroadcastPavedPreparationResult> {
  if (!input.audience_file) return draft;
  if (!dependencies.recipientSetSupplier) {
    return blocked(context, "The internal CSV audience supplier is unavailable.", [
      "broadcast_csv_audience_supplier_unavailable",
    ]);
  }

  let sourceSha256: string;
  try {
    const source = await dependencies.readFile(
      input.audience_file,
      BROADCAST_RECIPIENT_SET_MAX_BYTES,
    );
    try {
      sourceSha256 = createHash("sha256").update(source.bytes).digest("hex");
    } finally {
      source.bytes.fill(0);
    }
  } catch (error) {
    if (error instanceof BroadcastLocalFileError || error instanceof BroadcastRecipientSetFileError) {
      return blocked(context, "The CSV audience file could not be read or validated.", [
        error.reason,
      ]);
    }
    throw error;
  }

  const identity = deriveCsvRecipientIdentity(
    workspace,
    draft.draft_id,
    sourceSha256,
  );
  const supplier = await dependencies.recipientSetSupplier();
  const setInput = {
    workspace,
    draftId: draft.draft_id,
    setId: identity.oneTimeSetId,
  };
  const readSet = () => supplier.readBroadcastRecipientSet(setInput);
  let recipientSet: BroadcastRecipientSetResult;
  try {
    recipientSet = await readSet();
  } catch (readError) {
    if (!isRecipientSetNotFound(readError)) throw readError;
    try {
      const created = await supplier.createBroadcastRecipientSet({
        ...setInput,
        clientRequestKey: identity.clientRequestKey,
        expectedDraftVersion: draft.revision,
        csvFilePath: input.audience_file,
      });
      if (
        created.source.sha256 !== sourceSha256 ||
        created.recipient_set.one_time_set_id !== identity.oneTimeSetId ||
        created.recipient_set.draft_id !== draft.draft_id
      ) {
        return blocked(context, "The CSV supplier did not confirm the exact file digest and set identity.", [
          "broadcast_csv_audience_identity_mismatch",
        ]);
      }
      recipientSet = created.recipient_set;
    } catch (createError) {
      if (!isUnknownEffect(createError)) throw createError;
      try {
        recipientSet = await readSet();
      } catch (recoveryError) {
        if (isRecipientSetNotFound(recoveryError)) throw createError;
        throw recoveryError;
      }
    }
  }
  if (
    recipientSet.one_time_set_id !== identity.oneTimeSetId ||
    recipientSet.draft_id !== draft.draft_id
  ) {
    return blocked(context, "The CSV supplier returned a different durable set identity.", [
      "broadcast_csv_audience_identity_mismatch",
    ]);
  }

  for (
    let attempt = 0;
    recipientSet.status === "pending" &&
    attempt < MAX_RECIPIENT_SET_READ_ATTEMPTS;
    attempt += 1
  ) {
    recipientSet = await readSet();
    if (
      recipientSet.one_time_set_id !== identity.oneTimeSetId ||
      recipientSet.draft_id !== draft.draft_id
    ) {
      return blocked(context, "The CSV supplier returned a different durable set identity.", [
        "broadcast_csv_audience_identity_mismatch",
      ]);
    }
  }
  if (recipientSet.status === "unavailable") {
    return blocked(context, "The exact one-time CSV audience is unavailable.", [
      "broadcast_csv_audience_unavailable",
    ]);
  }
  if (recipientSet.status === "pending") {
    return preparing(
      context,
      `The CSV audience for draft ${draft.draft_id} is still preparing. Call fonte_prepare_broadcast again; no human action is required.`,
    );
  }

  const selection: BroadcastRecipientSelection = {
    to: {
      kind: "selected",
      references: [{ kind: "one_time", oneTimeSetId: identity.oneTimeSetId }],
    },
    except: [],
  };
  context.oneTimeSetId = identity.oneTimeSetId;
  const updated = await applyRecipientSelection(
    workspace,
    draft,
    selection,
    dependencies,
  );
  context.revision = updated.revision;
  return updated;
}

function deriveCsvRecipientIdentity(
  workspace: string,
  draftId: string,
  sourceSha256: string,
): { readonly oneTimeSetId: string; readonly clientRequestKey: string } {
  const scope = { workspace, draftId, sourceSha256 };
  return {
    oneTimeSetId: deterministicUuid("broadcast-paved-csv-set-v1", scope),
    clientRequestKey: deterministicUuid("broadcast-paved-csv-request-v1", scope),
  };
}

function isRecipientSetNotFound(error: unknown): boolean {
  return error instanceof CoreOperatorError && error.statusCode === 404;
}

async function applyRevision(
  initial: BroadcastDraftLifecycleResult,
  workspace: string,
  operation: unknown,
  mutate: (baseRevision: number, operationId: string) => Promise<RevisionedDraft>,
  matches: (snapshot: BroadcastDraftSnapshot) => boolean,
  dependencies: BroadcastPavedDependencies,
): Promise<BroadcastDraftLifecycleResult> {
  if (matches(initial.draft)) return initial;
  const operationId = deterministicUuid("broadcast-paved-revision-v1", {
    workspace,
    draftId: initial.draft_id,
    baseRevision: initial.revision,
    operation,
  });
  const lifecycle = await dependencies.draftLifecycle();
  const read = () =>
    lifecycle.readBroadcastDraft({
      workspace,
      draftId: initial.draft_id,
    });
  let receipt: RevisionedDraft;
  try {
    receipt = await mutate(initial.revision, operationId);
  } catch (error) {
    if (!isUnknownEffect(error)) throw error;
    let current = await read();
    if (matches(current.draft)) return current;
    if (current.revision !== initial.revision) {
      throw new CoreOperatorError(
        "broadcast_draft_revision_recovery_conflict",
        409,
        "none",
      );
    }
    try {
      await mutate(initial.revision, operationId);
    } catch (retryError) {
      if (!isUnknownEffect(retryError)) throw retryError;
    }
    current = await read();
    if (matches(current.draft)) return current;
    throw new CoreOperatorError(
      "broadcast_draft_revision_recovery_unresolved",
      null,
      "unknown",
    );
  }
  const current = await read();
  if (
    receipt.draft_id !== initial.draft_id ||
    current.draft_id !== initial.draft_id ||
    current.revision !== receipt.revision ||
    !matches(current.draft)
  ) {
    throw new CoreOperatorError(
      "broadcast_draft_readback_mismatch",
      409,
      "unknown",
    );
  }
  return current;
}

async function readHtmlSource(
  input: BroadcastPavedRequest,
  readFile: BroadcastLocalFileReader,
  requireSubject: boolean,
): Promise<BroadcastHtmlSource | null> {
  if (!input.html_source_file) return null;
  return prepareBroadcastHtmlSource(
    {
      sourceFile: input.html_source_file,
      referenceFile: input.html_reference_file ?? null,
      requireSubject,
      subject: input.subject ?? null,
      preheader: input.preheader ?? null,
      postalAddressLiteral: input.postal_address_literal ?? null,
      literalFallbacks: input.literal_fallbacks ?? {},
    },
    readFile,
  );
}

async function resolveWorkspace(
  selector: string | undefined,
  requestedEnvironment: "sandbox" | "production" | undefined,
  workspaces: readonly WorkspaceSummary[],
  selectedWorkspace: string | null = null,
): Promise<Resolution<{ workspace: WorkspaceSummary; environment: "production" }>> {
  if (workspaces.length === 0) {
    return {
      kind: "blocked",
      reason: "No workspace was returned by current workspace discovery.",
      warnings: ["workspace_catalog_empty"],
    };
  }
  let candidates: readonly WorkspaceSummary[];
  if (selector === undefined && selectedWorkspace !== null) {
    candidates = workspaces.filter(
      (workspace) => workspace.slug === selectedWorkspace,
    );
    if (candidates.length === 0) candidates = workspaces;
  } else if (selector === undefined) {
    candidates = workspaces;
  } else {
    candidates = workspaces.filter(
      (workspace) => workspace.slug === selector || workspace.name === selector,
    );
    if (candidates.length === 0) {
      return {
        kind: "needs_input",
        missing: ["workspace_selector"],
        choices: workspaceChoices(workspaces),
        summary: "No exact workspace slug or name matched the supplied selector.",
      };
    }
  }
  const unique = [...new Map(candidates.map((item) => [item.slug, item])).values()];
  if (unique.length !== 1) {
    return {
      kind: "needs_input",
      missing: ["workspace_selector"],
      choices: workspaceChoices(unique),
      summary: "Workspace resolution is ambiguous; choose one exact slug or name.",
    };
  }
  const workspace = unique[0]!;
  if (requestedEnvironment === "sandbox") {
    return {
      kind: "blocked",
      reason: "The available Broadcast suppliers in this SDK lineage support production only.",
      warnings: ["broadcast_environment_not_supported"],
    };
  }
  if (!workspace.available_environments.includes("production")) {
    return {
      kind: "blocked",
      reason: "Production is not listed as available for the exact selected workspace.",
      warnings: ["production_environment_unavailable"],
    };
  }
  return { kind: "selected", value: { workspace, environment: "production" } };
}

function resolveSender(
  profiles: readonly BroadcastSenderProfile[],
  currentId: string | null,
  selector: string | undefined,
): Resolution<BroadcastSenderProfile> {
  if (profiles.length === 0) {
    return {
      kind: "blocked",
      reason: "No verified sender profiles were returned for the selected workspace.",
      warnings: ["verified_sender_catalog_empty"],
    };
  }
  const selected =
    selector === undefined
      ? currentId === null
        ? profiles.length === 1
          ? [profiles[0]!]
          : [...profiles]
        : profiles.filter((profile) => profile.sender_profile_id === currentId)
      : profiles.filter((profile) => matchesSenderSelector(profile, selector));
  if (currentId !== null && selector === undefined && selected.length === 0) {
    return {
      kind: "blocked",
      reason: "The draft's current sender is not in the current verified sender catalog.",
      warnings: ["current_sender_not_verified"],
    };
  }
  if (selected.length === 1) return { kind: "selected", value: selected[0]! };
  if (selected.length === 0) {
    return {
      kind: "needs_input",
      missing: ["sender_selector"],
      choices: senderChoices(profiles),
      summary: "No verified sender exactly matched; choose one displayed name or email.",
    };
  }
  const publicSelectors = selected.map(senderSelectorValue);
  if (new Set(publicSelectors).size !== publicSelectors.length) {
    return {
      kind: "blocked",
      reason: "Multiple verified sender profiles have the same ordinary name-and-email selector; no safe product-level choice is available.",
      warnings: ["sender_selector_not_unique_without_profile_id"],
    };
  }
  return {
    kind: "needs_input",
    missing: ["sender_selector"],
    choices: senderChoices(selected),
    summary: "More than one verified sender matches; select one exact name, email, or displayed name-and-email pair.",
  };
}

function resolvePurpose(
  options: ProductionAudienceOptionsResult,
  currentId: string | null,
  selector: string | undefined,
): Resolution<ProductionAudienceOptionsResult["communication_purposes"][number]> {
  const purposes = options.communication_purposes;
  if (purposes.length === 0) {
    return {
      kind: "blocked",
      reason: "No communication purpose was returned by current purpose discovery.",
      warnings: ["communication_purpose_catalog_empty"],
    };
  }
  if (currentId !== null) {
    const current = purposes.filter((purpose) => purpose.communication_purpose_id === currentId);
    if (current.length !== 1) {
      return {
        kind: "blocked",
        reason: "The draft's current communication purpose is absent or ambiguous in current purpose discovery.",
        warnings: ["current_communication_purpose_not_verified"],
      };
    }
    if (selector === undefined) return { kind: "selected", value: current[0]! };
    const requested = purposes.filter((purpose) => purpose.label === selector);
    if (requested.length === 1 && requested[0]!.communication_purpose_id === currentId) {
      return { kind: "selected", value: current[0]! };
    }
    if (requested.length > 1) {
      return {
        kind: "blocked",
        reason: "Multiple current communication purposes share the same ordinary label; no safe product-level choice is available.",
        warnings: ["communication_purpose_label_not_unique"],
      };
    }
    return {
      kind: "blocked",
      reason: "The selected communication purpose differs from the existing draft; the current revision supplier cannot change that field.",
      warnings: ["broadcast_purpose_revision_unsupported"],
    };
  }
  if (selector !== undefined) {
    const exact = purposes.filter((purpose) => purpose.label === selector);
    if (exact.length === 1) return { kind: "selected", value: exact[0]! };
    if (exact.length > 1) {
      return {
        kind: "blocked",
        reason: "Multiple current communication purposes share the same ordinary label; no safe product-level choice is available.",
        warnings: ["communication_purpose_label_not_unique"],
      };
    }
    return {
      kind: "needs_input",
      missing: ["communication_purpose_selector"],
      choices: purposeChoices(purposes),
      summary: "No exact communication purpose label matched; choose one current label.",
    };
  }
  if (purposes.length === 1) return { kind: "selected", value: purposes[0]! };
  if (new Set(purposes.map((purpose) => purpose.label)).size !== purposes.length) {
    return {
      kind: "blocked",
      reason: "Multiple current communication purposes share ordinary labels, so the available purpose choices are not distinguishable.",
      warnings: ["communication_purpose_choices_not_distinguishable"],
    };
  }
  return {
    kind: "needs_input",
    missing: ["communication_purpose_selector"],
    choices: purposeChoices(purposes),
    summary: "Choose one exact communication purpose label.",
  };
}

function resolutionResult(
  context: PreparationContext,
  resolution: Exclude<Resolution<unknown>, { readonly kind: "selected" }>,
  fallbackSummary: string,
): BroadcastPavedPreparationResult {
  if (resolution.kind === "needs_input") {
    return needsInput(context, {
      missing: resolution.missing,
      choices: resolution.choices,
      summary: resolution.summary || fallbackSummary,
    });
  }
  return blocked(context, resolution.reason || fallbackSummary, resolution.warnings);
}

function readinessMissing(
  draft: BroadcastDraftSnapshot,
  sender: BroadcastSenderProfile,
  purpose: ProductionAudienceOptionsResult["communication_purposes"][number],
): string[] {
  const missing: string[] = [];
  if (!hasText(draft.title)) missing.push("title");
  if (!hasText(draft.subject)) missing.push("subject");
  const activeContent = draft.active_source === "html"
    ? draft.html_body
    : draft.composer_body;
  if (!hasText(activeContent)) missing.push("content");
  if (draft.sender_profile_id !== sender.sender_profile_id) missing.push("sender");
  if (draft.communication_purpose_id !== purpose.communication_purpose_id) {
    missing.push("communication_purpose");
  }
  if (!supportedCurrentAudience(draft)) missing.push("audience");
  return missing;
}

function supportedCurrentAudience(draft: BroadcastDraftSnapshot): boolean {
  if (draft.audience_kind === "all_contacts") {
    return (draft.recipient_expression === null || draft.recipient_expression === undefined) &&
      (draft.recipient_selection === null || draft.recipient_selection === undefined);
  }
  if (draft.audience_kind === "contact_import") {
    return draft.audience_contact_import_batch_id !== null &&
      draft.recipient_expression === null &&
      draft.recipient_selection === null;
  }
  if (draft.audience_kind !== "recipient_expression") return false;
  if (draft.recipient_selection !== null) {
    try {
      parseBroadcastRecipientSelection(draft.recipient_selection);
      return true;
    } catch {
      return false;
    }
  }
  if (draft.recipient_expression !== null) {
    try {
      preflightRecipientExpression(draft.recipient_expression);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isCurrentAllContacts(draft: BroadcastDraftSnapshot): boolean {
  if (draft.audience_kind === "all_contacts") return supportedCurrentAudience(draft);
  if (draft.recipient_selection === null) return false;
  try {
    return sameBroadcastRecipientSelection(
      parseBroadcastRecipientSelection(draft.recipient_selection),
      ALL_CONTACTS_SELECTION,
    );
  } catch {
    return false;
  }
}

function isExactOneTimeAudience(
  draft: BroadcastDraftSnapshot,
  oneTimeSetId: string,
): boolean {
  try {
    return sameBroadcastRecipientSelection(
      parseBroadcastRecipientSelection(draft.recipient_selection),
      {
        to: {
          kind: "selected",
          references: [{ kind: "one_time", oneTimeSetId }],
        },
        except: [],
      },
    );
  } catch {
    return false;
  }
}

function sameCreatedIdentity(
  draft: BroadcastDraftSnapshot,
  input: {
    readonly title?: string | null;
    readonly subject?: string | null;
  },
): boolean {
  return draft.title === input.title && draft.subject === input.subject;
}

function sameCreateCoreFields(
  draft: BroadcastDraftSnapshot,
  input: {
    readonly title: string;
    readonly subject: string;
    readonly preheader: string | null;
    readonly senderProfileId: string;
    readonly communicationPurposeId: string;
    readonly body: string;
  },
): boolean {
  return draft.title === input.title &&
    draft.subject === input.subject &&
    draft.preheader === input.preheader &&
    draft.sender_profile_id === input.senderProfileId &&
    draft.communication_purpose_id === input.communicationPurposeId &&
    draft.text_body === input.body &&
    draft.audience_kind === "all_contacts";
}

function matchesChanges(
  draft: BroadcastDraftSnapshot,
  changes: BroadcastDraftRevisionChanges,
): boolean {
  const pairs: readonly [keyof BroadcastDraftRevisionChanges, keyof BroadcastDraftSnapshot][] = [
    ["title", "title"],
    ["subject", "subject"],
    ["preheader", "preheader"],
    ["sender", "sender_profile_id"],
    ["replyTo", "reply_to"],
    ["textBody", "text_body"],
    ["activeSource", "active_source"],
    ["composerBody", "composer_body"],
    ["htmlBody", "html_body"],
  ];
  return pairs.every(([changeKey, snapshotKey]) =>
    !Object.hasOwn(changes, changeKey) ||
    draft[snapshotKey] === changes[changeKey],
  );
}

async function readDraftIfExists(
  lifecycle: BroadcastDraftLifecycleClient,
  workspace: string,
  draftId: string,
): Promise<BroadcastDraftLifecycleResult | null> {
  try {
    return await lifecycle.readBroadcastDraft({ workspace, draftId });
  } catch (error) {
    if (error instanceof CoreOperatorError && error.statusCode === 404) return null;
    throw error;
  }
}

function workspaceChoices(
  workspaces: readonly WorkspaceSummary[],
): BroadcastPavedChoice[] {
  return workspaces.map((workspace) => ({
    field: "workspace_selector",
    value: workspace.slug,
    label: `${workspace.name} (${workspace.slug})`,
  }));
}

function senderChoices(profiles: readonly BroadcastSenderProfile[]): BroadcastPavedChoice[] {
  return profiles.map((profile) => ({
    field: "sender_selector",
    value: senderSelectorValue(profile),
    label: `${profile.name} <${profile.email}>`,
  }));
}

function purposeChoices(
  purposes: ProductionAudienceOptionsResult["communication_purposes"],
): BroadcastPavedChoice[] {
  return purposes.map((purpose) => ({
    field: "communication_purpose_selector",
    value: purpose.label,
    label: purpose.label,
  }));
}

function allContactsChoice(): BroadcastPavedChoice {
  return {
    field: "audience_selector",
    value: "all_contacts",
    label: "All contacts (no exclusions)",
  };
}

function matchesSenderSelector(
  profile: BroadcastSenderProfile,
  selector: string,
): boolean {
  const normalized = selector.toLowerCase();
  return profile.name.toLowerCase() === normalized ||
    profile.email.toLowerCase() === normalized ||
    senderSelectorValue(profile).toLowerCase() === normalized;
}

function senderSelectorValue(profile: BroadcastSenderProfile): string {
  return `${profile.name} <${profile.email}>`;
}

function isAllContactsSelector(value: string): boolean {
  return value === "all_contacts" || value === "everyone";
}

function needsInput(
  context: PreparationContext,
  input: {
    readonly missing: readonly string[];
    readonly choices: readonly BroadcastPavedChoice[];
    readonly summary: string;
  },
): BroadcastPavedPreparationResult {
  return {
    status: "needs_input",
    draft_id: context.draftId,
    revision: context.revision,
    summary: input.summary,
    missing: [...input.missing],
    choices: [...input.choices],
    warnings: [...context.warnings],
    send_input: null,
  };
}

function blocked(
  context: PreparationContext,
  summary: string,
  warnings: readonly string[],
): BroadcastPavedPreparationResult {
  return {
    status: "blocked",
    draft_id: context.draftId,
    revision: context.revision,
    summary,
    missing: [],
    choices: [],
    warnings: [...context.warnings, ...warnings],
    send_input: null,
  };
}

function preparing(
  context: PreparationContext,
  summary: string,
): BroadcastPavedPreparationResult {
  return {
    status: "preparing",
    draft_id: context.draftId,
    revision: context.revision,
    summary,
    missing: [],
    choices: [],
    warnings: [...context.warnings],
    send_input: null,
  };
}

async function sendPrepared(
  input: BroadcastPavedSendInput,
  dependencies: BroadcastPavedDependencies,
): Promise<OperatorReceipt> {
  const command: OperatorCommand = {
    kind: "broadcast_send_now",
    workspace: input.workspace,
    draftId: input.draft_id,
    requestId: input.request_id,
    expectedDraftVersion: input.expected_revision,
  };
  try {
    const current = await (
      await dependencies.draftLifecycle()
    ).readBroadcastDraft({
      workspace: input.workspace,
      draftId: input.draft_id,
    });
    if (
      current.draft_id !== input.draft_id ||
      current.revision !== input.expected_revision ||
      hash(stableJson(current.draft)) !== input.snapshot_sha256
    ) {
      return sendFailureReceipt(
        input.workspace,
        "prepared_draft_state_changed",
        "none",
        "current",
      );
    }

    const client = await dependencies.send();
    const sendInput = {
      workspace: input.workspace,
      draftId: input.draft_id,
      requestId: input.request_id,
      expectedDraftVersion: input.expected_revision,
      timing: { mode: "now" as const },
    };
    try {
      return sendSuccessReceipt(
        command,
        await client.acceptBroadcastSend(sendInput),
      );
    } catch (error) {
      if (!isUnknownEffect(error)) {
        return sendFailureReceipt(
          input.workspace,
          safeReason(error),
          error instanceof CoreOperatorError ? error.coreEffect : "none",
          "current",
        );
      }
      try {
        await client.readBroadcastSendOperation({
          workspace: input.workspace,
          draftId: input.draft_id,
        });
      } catch {
        return sendFailureReceipt(
          input.workspace,
          "broadcast_send_outcome_unresolved",
          "unknown",
          "current",
        );
      }
      try {
        const retried = await client.acceptBroadcastSend(sendInput);
        return sendSuccessReceipt(command, retried);
      } catch (retryError) {
        if (isUnknownEffect(retryError)) {
          try {
            await client.readBroadcastSendOperation({
              workspace: input.workspace,
              draftId: input.draft_id,
            });
          } catch {
            // The first Send outcome remains unknown even when its final read is unavailable.
          }
        }
        return sendFailureReceipt(
          input.workspace,
          "broadcast_send_outcome_unresolved",
          "unknown",
          "current",
        );
      }
    }
  } catch (error) {
    return sendFailureReceipt(
      input.workspace,
      safeReason(error),
      error instanceof CoreOperatorError ? error.coreEffect : "none",
      "current",
    );
  }
}

function sendSuccessReceipt(
  command: OperatorCommand,
  result: BroadcastSendOperationResult,
): OperatorReceipt {
  if (command.kind !== "broadcast_send_now") {
    return sendFailureReceipt(
      null,
      "broadcast_send_receipt_identity_mismatch",
      "unknown",
      "current",
    );
  }
  if (
    result.status !== "accepted" ||
    result.operation.draft_id !== command.draftId
  ) {
    return sendFailureReceipt(
      command.workspace,
      "broadcast_send_receipt_identity_mismatch",
      "unknown",
      "current",
    );
  }
  const descriptor = broadcastSendInstructionReceiptDescriptor(command, result);
  if (!descriptor) {
    return sendFailureReceipt(
      command.workspace,
      "broadcast_send_receipt_unmappable",
      "unknown",
      "current",
    );
  }
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome: descriptor.outcome,
    reason: descriptor.reason,
    workspace: command.workspace,
    authority: {
      status: "current",
      contract_id: "fonte.core.broadcast_send_instruction.v3",
    },
    core_effect: descriptor.coreEffect,
    result,
  };
}

function sendFailureReceipt(
  workspace: string | null,
  reason: string,
  coreEffect: OperatorReceipt["core_effect"],
  authorityStatus: "current" | "missing",
): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: "broadcast_send_now",
    outcome: "blocked",
    reason: /^[a-z0-9_]{1,100}$/u.test(reason) ? reason : "broadcast_send_blocked",
    workspace,
    authority: authorityStatus === "current"
      ? {
        status: "current",
        contract_id: "fonte.core.broadcast_send_instruction.v3",
      }
      : { status: "missing", contract_id: "unavailable" },
    core_effect: coreEffect,
    result: null,
  };
}

function isUnknownEffect(error: unknown): boolean {
  return error instanceof CoreOperatorError && error.coreEffect === "unknown";
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeReason(error: unknown): string {
  if (error instanceof CoreOperatorError && /^[a-z0-9_]{1,100}$/u.test(error.reason)) {
    return error.reason;
  }
  if (
    (error instanceof BroadcastLocalFileError ||
      error instanceof BroadcastRecipientSetFileError) &&
    /^[a-z0-9_]{1,100}$/u.test(error.reason)
  ) {
    return error.reason;
  }
  return "operator_request_failed";
}

function deterministicUuid(scope: string, value: unknown): string {
  const bytes = createHash("sha256")
    .update(scope)
    .update("\0")
    .update(stableJson(value))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
