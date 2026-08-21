import {
  boundedText,
  content,
  invalidProductionArguments,
  operatorArguments,
  optionalText,
  parseProductionOptions,
  required,
  requireProduction,
  uuid,
  versionedUuid,
  workspace,
  type ProductionOptions,
} from "./operator-production-options.js";
import type {
  ProductionAudienceInput,
  RecipientReferenceInput,
} from "./operator-production-types.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

export function parseProductionDraftCreate(
  argv: readonly string[],
): ParsedOperatorArguments {
  const options = parseProductionOptions(
    argv,
    [
      "--workspace",
      "--environment",
      "--idempotency-key",
      "--title",
      "--subject",
      "--body",
      "--preheader",
      "--sender-profile-id",
      "--reply-to",
      "--communication-purpose-id",
    ],
    [
      "--include-collection",
      "--include-import-batch",
      "--exclude-collection",
      "--exclude-import-batch",
    ],
    ["--all-contacts"],
  );
  requireProduction(options);
  return operatorArguments(options, {
    kind: "broadcast_draft_create",
    workspace: workspace(options),
    idempotencyKey: uuid(
      required(options, "--idempotency-key"),
      "--idempotency-key",
    ),
    title: boundedText(required(options, "--title"), 100, "--title"),
    subject: boundedText(required(options, "--subject"), 500, "--subject"),
    body: content(required(options, "--body"), 750_000, "--body"),
    preheader: optionalText(options, "--preheader", 500),
    senderProfileId: boundedText(
      required(options, "--sender-profile-id"),
      500,
      "--sender-profile-id",
    ),
    replyTo: optionalText(options, "--reply-to", 320),
    communicationPurposeId: versionedUuid(
      required(options, "--communication-purpose-id"),
      "--communication-purpose-id",
    ),
    audience: audience(options),
  });
}

function audience(options: ProductionOptions): ProductionAudienceInput {
  const include = references(options, "include");
  const exclude = references(options, "exclude");
  if (options.flags.has("--all-contacts")) {
    if (include.length > 0 || exclude.length > 0) {
      invalidProductionArguments("invalid_field", "--audience");
    }
    return { kind: "all_contacts", expression: null };
  }
  if (include.length === 0 || include.length > 20 || exclude.length > 20) {
    invalidProductionArguments("invalid_field", "--audience");
  }
  const keys = [...include, ...exclude].map(referenceKey);
  if (new Set(keys).size !== keys.length) {
    invalidProductionArguments("duplicate_field", "--audience");
  }
  return { kind: "recipient_expression", expression: { include, exclude } };
}

function references(
  options: ProductionOptions,
  side: "include" | "exclude",
): readonly RecipientReferenceInput[] {
  return [
    ...(options.repeated.get(`--${side}-collection`) ?? []).map((value) => ({
      kind: "collection" as const,
      collectionId: versionedUuid(value, `--${side}-collection`),
    })),
    ...(options.repeated.get(`--${side}-import-batch`) ?? []).map((value) => ({
      kind: "import_batch" as const,
      contactImportBatchId: versionedUuid(value, `--${side}-import-batch`),
    })),
  ];
}

function referenceKey(value: RecipientReferenceInput): string {
  return value.kind === "collection"
    ? `collection:${value.collectionId}`
    : `import_batch:${value.contactImportBatchId}`;
}
