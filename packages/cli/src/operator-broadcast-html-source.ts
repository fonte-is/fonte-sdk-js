import { sha256 } from "./digests.js";
import {
  convertBroadcastHtml,
  type BroadcastHtmlConversion,
} from "./operator-broadcast-html-conversion.js";
import {
  BROADCAST_HTML_MAX_BYTES,
  BROADCAST_REFERENCE_MAX_BYTES,
  BroadcastLocalFileError,
  type BroadcastLocalFileReader,
} from "./operator-broadcast-html-file.js";
import {
  broadcastHtmlWarnings,
  inspectBroadcastHtml,
  type BroadcastHtmlInspection,
} from "./operator-broadcast-html-inspection.js";

const SLOT_SCHEMA = "fonte-core-recipient-slots-v1";
const SUPPORTED_SLOTS = [
  "{{{contact.email}}}",
  "{{{unsubscribe_url}}}",
  "{{{postal_address}}}",
] as const;

export interface BroadcastHtmlSourceInput {
  readonly sourceFile: string;
  readonly referenceFile: string | null;
  readonly requireSubject: boolean;
  readonly subject: string | null;
  readonly preheader: string | null;
  readonly postalAddressLiteral: string | null;
  readonly literalFallbacks: Readonly<Record<string, string>>;
}

export interface BroadcastHtmlSourceReport {
  readonly schema_version: "fonte-broadcast-html-intake-v1";
  readonly source_file: string;
  readonly source_bytes: number;
  readonly source_sha256: string;
  readonly prepared_bytes: number;
  readonly prepared_sha256: string;
  readonly recipient_slot_schema_version: typeof SLOT_SCHEMA;
  readonly supported_slots: readonly { token: string; occurrences: number }[];
  readonly unsupported_tokens: readonly string[];
  readonly conversions: readonly BroadcastHtmlConversion[];
  readonly asset_dependencies: readonly string[];
  readonly font_status: "declared" | "unverified";
  readonly reference: null | {
    readonly file: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly visual_verification:
    "unverified_missing_reference" | "reference_bound_not_compared";
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly plain_text_source: "core_canonical_render";
}

export interface BroadcastHtmlSource {
  readonly html: string;
  readonly report: BroadcastHtmlSourceReport;
}

export class BroadcastHtmlSourceError extends Error {
  public constructor(readonly reason: string) {
    super(reason);
    this.name = "BroadcastHtmlSourceError";
  }
}

export async function prepareBroadcastHtmlSource(
  input: BroadcastHtmlSourceInput,
  readFile: BroadcastLocalFileReader,
): Promise<BroadcastHtmlSource> {
  const source = await readFile(input.sourceFile, BROADCAST_HTML_MAX_BYTES);
  const original = strictUtf8(source.bytes);
  const reference =
    input.referenceFile === null
      ? null
      : await readReference(input.referenceFile, readFile);
  const converted = convertBroadcastHtml(original, input);
  const preparedBytes = new TextEncoder().encode(converted.html);
  const analysis = inspectBroadcastHtml(converted.html);
  const blockers = blockersFor(
    input,
    source.bytes,
    preparedBytes,
    analysis,
    converted.unusedFallbacks,
    converted.postalAddressLiteralMissing,
  );
  return {
    html: converted.html,
    report: {
      schema_version: "fonte-broadcast-html-intake-v1",
      source_file: source.path,
      source_bytes: source.bytes.byteLength,
      source_sha256: digest(source.bytes),
      prepared_bytes: preparedBytes.byteLength,
      prepared_sha256: digest(preparedBytes),
      recipient_slot_schema_version: SLOT_SCHEMA,
      supported_slots: SUPPORTED_SLOTS.map((token) => ({
        token,
        occurrences: occurrences(converted.html, token),
      })),
      unsupported_tokens: converted.unsupportedTokens,
      conversions: converted.conversions,
      asset_dependencies: analysis.assets,
      font_status: /font-family\s*:/iu.test(converted.html)
        ? "declared"
        : "unverified",
      reference: reference && {
        file: reference.path,
        bytes: reference.bytes.byteLength,
        sha256: digest(reference.bytes),
      },
      visual_verification: reference
        ? "reference_bound_not_compared"
        : "unverified_missing_reference",
      warnings: broadcastHtmlWarnings(converted.html, reference !== null),
      blockers,
      plain_text_source: "core_canonical_render",
    },
  };
}

async function readReference(file: string, readFile: BroadcastLocalFileReader) {
  try {
    return await readFile(file, BROADCAST_REFERENCE_MAX_BYTES);
  } catch (error) {
    if (error instanceof BroadcastLocalFileError) {
      throw new BroadcastLocalFileError(
        error.reason.replace("broadcast_source_", "broadcast_reference_"),
      );
    }
    throw error;
  }
}

function blockersFor(
  input: BroadcastHtmlSourceInput,
  source: Uint8Array,
  prepared: Uint8Array,
  analysis: BroadcastHtmlInspection,
  unusedFallbacks: readonly string[],
  postalAddressLiteralMissing: boolean,
): string[] {
  const blockers: string[] = [];
  if (source.byteLength === 0) blockers.push("broadcast_source_file_empty");
  if (prepared.byteLength > BROADCAST_HTML_MAX_BYTES) {
    blockers.push("broadcast_prepared_html_too_large");
  }
  if (input.requireSubject && !input.subject?.trim()) {
    blockers.push("broadcast_subject_missing");
  }
  if (
    input.requireSubject &&
    (containsRecipientSlot(input.subject) ||
      containsRecipientSlot(input.preheader))
  ) {
    blockers.push("broadcast_recipient_slot_location_invalid");
  }
  if (analysis.unsupported.length > 0) {
    blockers.push("broadcast_recipient_slot_unsupported");
  }
  if (analysis.malformed) blockers.push("broadcast_recipient_slot_malformed");
  if (analysis.controlCharacter)
    blockers.push("broadcast_source_control_character");
  if (unusedFallbacks.length > 0)
    blockers.push("broadcast_literal_fallback_unused");
  if (postalAddressLiteralMissing) {
    blockers.push("broadcast_postal_address_literal_not_found");
  }
  if (analysis.assets.length > 0) {
    blockers.push("broadcast_asset_dependency_unresolved");
  }
  return [...new Set(blockers)];
}

function strictUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new BroadcastHtmlSourceError("broadcast_source_invalid_utf8");
  }
}

function containsRecipientSlot(value: string | null): boolean {
  return (
    value !== null &&
    (/\{\{\{?[A-Za-z_][A-Za-z0-9_.]*\}\}\}?/u.test(value) ||
      /\{\{\{?[A-Za-z_][A-Za-z0-9_.]*$/u.test(value))
  );
}

function occurrences(value: string, search: string): number {
  return search.length === 0 ? 0 : value.split(search).length - 1;
}

function digest(value: Uint8Array): string {
  return `sha256:${sha256(value)}`;
}
