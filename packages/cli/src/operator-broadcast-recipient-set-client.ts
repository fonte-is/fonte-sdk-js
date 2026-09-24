import { createHash } from "node:crypto";
import path from "node:path";

import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { instant, object, uuid } from "./operator-json.js";
import {
  BroadcastLocalFileError,
  type BroadcastLocalFileReader,
} from "./operator-broadcast-html-file.js";

export const BROADCAST_RECIPIENT_SET_MAX_BYTES = 16 * 1_048_576;

export interface BroadcastRecipientSetCreateInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly setId: string;
  readonly clientRequestKey: string;
  readonly expectedDraftVersion: number;
  readonly csvFilePath: string;
  readonly sourceFileName?: string;
}

export interface BroadcastRecipientSetReadInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly setId: string;
}

export interface BroadcastRecipientSetResult {
  readonly kind: "broadcast_recipient_set";
  readonly one_time_set_id: string;
  readonly draft_id: string;
  readonly status: "pending" | "completed" | "unavailable";
  readonly operation_status: "pending" | "completed" | "unavailable";
  readonly contact_import_batch_id: string | null;
  readonly created_at: string;
  readonly population_effect: "broadcast_only_not_everyone";
}

export interface BroadcastRecipientSetSource {
  readonly file_name: string;
  readonly sha256: string;
  readonly byte_length: number;
  readonly row_count: number;
}

export interface BroadcastRecipientSetCreateResult {
  readonly recipient_set: BroadcastRecipientSetResult;
  readonly source: BroadcastRecipientSetSource;
}

/** Internal seam for the paved Broadcast operator; it never returns CSV rows. */
export interface BroadcastRecipientSetClient {
  createBroadcastRecipientSet(
    input: BroadcastRecipientSetCreateInput,
  ): Promise<BroadcastRecipientSetCreateResult>;
  readBroadcastRecipientSet(
    input: BroadcastRecipientSetReadInput,
  ): Promise<BroadcastRecipientSetResult>;
}

export class BroadcastRecipientSetFileError extends Error {
  public constructor(readonly reason: string) {
    super(reason);
    this.name = "BroadcastRecipientSetFileError";
  }
}

export function createBroadcastRecipientSetClient(
  request: CoreRequester,
  readFile: BroadcastLocalFileReader,
): BroadcastRecipientSetClient {
  return {
    async createBroadcastRecipientSet(input) {
      const source = await recipientCsv(input, readFile);
      let csvText = source.csvText;
      try {
        const created = parseCoreReceipt(
          recipientSetReceipt,
          await request(
            `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}`
              + "/recipient-sets?environment=production",
            {
              lostResponseEffect: "unknown",
              body: {
                setId: input.setId,
                clientRequestKey: input.clientRequestKey,
                expectedDraftVersion: input.expectedDraftVersion,
                usage: "include",
                csvText,
                sourceFileName: source.metadata.file_name,
              },
            },
          ),
          "unknown",
        );
        requireExactSet(created, input, "unknown");

        let recipientSet: BroadcastRecipientSetResult;
        try {
          recipientSet = await readRecipientSet(request, input, "unknown");
        } catch (error) {
          if (error instanceof CoreOperatorError) {
            throw new CoreOperatorError(
              error.reason,
              error.statusCode,
              "unknown",
            );
          }
          throw error;
        }
        if (recipientSet.created_at !== created.created_at) {
          invalidReceipt("unknown");
        }
        return { recipient_set: recipientSet, source: source.metadata };
      } finally {
        csvText = "";
        source.bytes.fill(0);
      }
    },

    readBroadcastRecipientSet(input) {
      return readRecipientSet(request, input, "none");
    },
  };
}

async function recipientCsv(
  input: BroadcastRecipientSetCreateInput,
  readFile: BroadcastLocalFileReader,
): Promise<{
  readonly bytes: Uint8Array;
  readonly csvText: string;
  readonly metadata: BroadcastRecipientSetSource;
}> {
  if (!path.isAbsolute(input.csvFilePath)) {
    throw new BroadcastLocalFileError("broadcast_source_path_not_absolute");
  }
  if (path.extname(input.csvFilePath).toLowerCase() !== ".csv") {
    throw new BroadcastRecipientSetFileError("csv_file_extension_invalid");
  }
  const file = await readFile(input.csvFilePath, BROADCAST_RECIPIENT_SET_MAX_BYTES);
  try {
    if (!(file.bytes instanceof Uint8Array)) {
      throw new BroadcastRecipientSetFileError("csv_file_content_invalid");
    }
    if (file.bytes.byteLength > BROADCAST_RECIPIENT_SET_MAX_BYTES) {
      throw new BroadcastLocalFileError("broadcast_source_file_too_large");
    }
    const fileName = input.sourceFileName ?? path.basename(input.csvFilePath);
    if (
      !fileName ||
      fileName.length > 255 ||
      fileName !== path.basename(fileName) ||
      fileName.includes("\\") ||
      /[\p{C}]/u.test(fileName)
    ) {
      throw new BroadcastRecipientSetFileError("source_file_name_invalid");
    }

    let csvText: string;
    try {
      // Preserve a UTF-8 BOM in the uploaded text and digest; the CSV parser below
      // ignores it for header validation, matching Core's BOM-aware parser.
      csvText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        file.bytes,
      );
    } catch {
      throw new BroadcastRecipientSetFileError("csv_file_encoding_invalid");
    }
    if (csvText.includes("\u0000")) {
      throw new BroadcastRecipientSetFileError("csv_file_content_invalid");
    }
    const rowCount = recipientCsvRowCount(csvText);
    return {
      bytes: file.bytes,
      csvText,
      metadata: {
        file_name: fileName,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        byte_length: file.bytes.byteLength,
        row_count: rowCount,
      },
    };
  } catch (error) {
    file.bytes.fill(0);
    throw error;
  }
}

/** Counts parsed records while retaining header cells only, never recipient rows. */
function recipientCsvRowCount(csvText: string): number {
  const source = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const headers: string[] = [];
  let field = "";
  let recordIndex = 0;
  let rowCount = 0;
  let inQuotes = false;
  let afterQuote = false;
  let fieldStarted = false;
  let recordPending = false;

  const append = (value: string) => {
    if (recordIndex === 0) field += value;
  };
  const finishField = () => {
    if (recordIndex === 0) {
      headers.push(field.trim());
      if (headers.length > 51) {
        throw new BroadcastRecipientSetFileError("csv_email_header_invalid");
      }
    }
    field = "";
    fieldStarted = false;
    afterQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (recordIndex === 0) {
      if (
        headers.length === 0 ||
        headers.length > 51 ||
        headers.some((header) =>
          !header ||
          header.length > 200 ||
          /[\p{Cc}]/u.test(header) ||
          ["__proto__", "constructor", "prototype"].includes(header)
        ) ||
        new Set(headers).size !== headers.length ||
        headers.filter((header) => header === "email").length !== 1
      ) {
        throw new BroadcastRecipientSetFileError("csv_email_header_invalid");
      }
    } else {
      rowCount += 1;
    }
    recordIndex += 1;
    recordPending = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        append(character);
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        finishField();
        recordPending = true;
      } else if (character === "\r" || character === "\n") {
        finishRecord();
        if (character === "\r" && source[index + 1] === "\n") index += 1;
      } else {
        throw new BroadcastRecipientSetFileError("csv_file_content_invalid");
      }
      continue;
    }

    if (character === '"') {
      if (fieldStarted) {
        throw new BroadcastRecipientSetFileError("csv_file_content_invalid");
      }
      inQuotes = true;
      fieldStarted = true;
      recordPending = true;
    } else if (character === ",") {
      finishField();
      recordPending = true;
    } else if (character === "\r" || character === "\n") {
      finishRecord();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      append(character);
      fieldStarted = true;
      recordPending = true;
    }
  }

  if (inQuotes) {
    throw new BroadcastRecipientSetFileError("csv_file_content_invalid");
  }
  if (recordPending) finishRecord();
  if (recordIndex === 0) {
    throw new BroadcastRecipientSetFileError("csv_email_header_invalid");
  }
  return rowCount;
}

async function readRecipientSet(
  request: CoreRequester,
  input: BroadcastRecipientSetReadInput,
  effectOnInvalid: "none" | "unknown",
): Promise<BroadcastRecipientSetResult> {
  const recipientSet = parseCoreReceipt(
    recipientSetReceipt,
    await request(
      `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}`
        + `/recipient-sets/${segment(input.setId)}?environment=production`,
    ),
    effectOnInvalid,
  );
  requireExactSet(recipientSet, input, effectOnInvalid);
  return recipientSet;
}

function recipientSetReceipt(value: unknown): BroadcastRecipientSetResult {
  const envelope = object(value);
  if (envelope.environment !== "production") invalidReceipt("none");
  const result = object(envelope.result);
  const status = oneTimeStatus(result.status);
  const operationStatus = oneTimeStatus(result.operationStatus);
  if (result.populationEffect !== "broadcast_only_not_everyone") {
    invalidReceipt("none");
  }
  return {
    kind: "broadcast_recipient_set",
    one_time_set_id: uuid(result.oneTimeSetId),
    draft_id: uuid(result.draftId),
    status,
    operation_status: operationStatus,
    contact_import_batch_id:
      result.contactImportBatchId === null
        ? null
        : uuid(result.contactImportBatchId),
    created_at: instant(result.createdAt),
    population_effect: "broadcast_only_not_everyone",
  };
}

function oneTimeStatus(
  value: unknown,
): BroadcastRecipientSetResult["status"] {
  if (value !== "pending" && value !== "completed" && value !== "unavailable") {
    invalidReceipt("none");
  }
  return value;
}

function requireExactSet(
  value: BroadcastRecipientSetResult,
  input: BroadcastRecipientSetReadInput,
  effect: "none" | "unknown",
): void {
  if (
    value.one_time_set_id !== input.setId ||
    value.draft_id !== input.draftId
  ) {
    invalidReceipt(effect);
  }
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalidReceipt(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
