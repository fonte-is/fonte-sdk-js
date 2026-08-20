import type { CoreRequester } from "./operator-core-request.js";
import { CoreOperatorError } from "./operator-core-request.js";
import { broadcastPreflight } from "./operator-preflight-json.js";
import type { BroadcastPreflightResult } from "./operator-preflight-types.js";

export interface BroadcastPreflightInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly postalAddress: string;
}

export async function requestBroadcastPreflight(
  request: CoreRequester,
  input: BroadcastPreflightInput,
): Promise<BroadcastPreflightResult> {
  validate(input);
  const value = await request(
    `/v1/workspaces/${segment(input.workspace)}/marketing-broadcasts/${segment(input.draftId)}/preflight?environment=${input.environment}`,
    {
      body: {
        expectedVersion: input.expectedVersion,
        postalAddress: input.postalAddress,
      },
      lostResponseEffect: "none",
    },
  );
  let result: BroadcastPreflightResult;
  try {
    result = broadcastPreflight(value);
  } catch {
    return invalidReceipt();
  }
  if (
    result.workspace_slug !== input.workspace ||
    result.environment !== input.environment ||
    result.broadcast_draft_id !== input.draftId ||
    result.requested_draft_version !== input.expectedVersion
  )
    return invalidReceipt();
  return result;
}

function validate(input: BroadcastPreflightInput): void {
  if (
    (input.environment !== "sandbox" && input.environment !== "production") ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.draftId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    typeof input.postalAddress !== "string" ||
    !input.postalAddress.trim() ||
    input.postalAddress.length > 2_000
  )
    throw new CoreOperatorError("broadcast_preflight_invalid", null, "none");
}

function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
