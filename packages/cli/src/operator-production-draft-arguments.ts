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
    idempotencyKey: uuid(required(options, "--idempotency-key")),
    title: boundedText(required(options, "--title"), 100),
    subject: boundedText(required(options, "--subject"), 500),
    body: content(required(options, "--body"), 750_000),
    preheader: optionalText(options, "--preheader", 500),
    senderProfileId: boundedText(required(options, "--sender-profile-id"), 500),
    replyTo: optionalText(options, "--reply-to", 320),
    communicationPurposeId: versionedUuid(
      required(options, "--communication-purpose-id"),
    ),
    audience: audience(options),
  });
}

function audience(options: ProductionOptions): ProductionAudienceInput {
  const include = references(options, "include");
  const exclude = references(options, "exclude");
  if (options.flags.has("--all-contacts")) {
    if (include.length > 0 || exclude.length > 0) invalidProductionArguments();
    return { kind: "all_contacts", expression: null };
  }
  if (include.length === 0 || include.length > 20 || exclude.length > 20) {
    invalidProductionArguments();
  }
  const keys = [...include, ...exclude].map(referenceKey);
  if (new Set(keys).size !== keys.length) invalidProductionArguments();
  return { kind: "recipient_expression", expression: { include, exclude } };
}

function references(
  options: ProductionOptions,
  side: "include" | "exclude",
): readonly RecipientReferenceInput[] {
  return [
    ...(options.repeated.get(`--${side}-collection`) ?? []).map((value) => ({
      kind: "collection" as const,
      collectionId: versionedUuid(value),
    })),
    ...(options.repeated.get(`--${side}-import-batch`) ?? []).map((value) => ({
      kind: "import_batch" as const,
      contactImportBatchId: versionedUuid(value),
    })),
  ];
}

function referenceKey(value: RecipientReferenceInput): string {
  return value.kind === "collection"
    ? `collection:${value.collectionId}`
    : `import_batch:${value.contactImportBatchId}`;
}
