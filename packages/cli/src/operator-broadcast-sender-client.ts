import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { record } from "./operator-broadcast-draft-snapshot.js";
import type {
  BroadcastDraftRevisionClient,
  BroadcastDraftRevisionResult,
} from "./operator-broadcast-draft-revision-client.js";

export interface BroadcastSenderProfile {
  readonly sender_profile_id: string;
  readonly name: string;
  readonly email: string;
  readonly default_reply_to: string;
}

export interface BroadcastSenderResolution {
  readonly outcome: "selected" | "ambiguous" | "not_found";
  readonly sender_profile_id: string | null;
  readonly candidate_sender_profile_ids: readonly string[];
}

export interface BroadcastSenderCatalog {
  readonly kind: "broadcast_sender_catalog";
  readonly sender_profiles: readonly BroadcastSenderProfile[];
  readonly resolution: BroadcastSenderResolution;
}

export interface BroadcastSenderClient {
  listBroadcastSenders(input: {
    readonly workspace: string;
    readonly match: string | null;
  }): Promise<BroadcastSenderCatalog>;
  updateBroadcastSender(input: {
    readonly workspace: string;
    readonly draftId: string;
    readonly baseRevision: number;
    readonly operationId: string;
    readonly senderProfileId: string;
    readonly replyTo?: string;
  }): Promise<BroadcastDraftRevisionResult>;
}

export function createBroadcastSenderClient(
  request: CoreRequester,
  revision: BroadcastDraftRevisionClient,
): BroadcastSenderClient {
  return {
    async listBroadcastSenders(input) {
      const profiles = parseCoreReceipt(
        senderCatalogReceipt,
        await request(
          `${workspacePath(input.workspace)}/delivery/sender-domains?environment=production`,
        ),
      );
      return {
        kind: "broadcast_sender_catalog",
        sender_profiles: profiles,
        resolution: resolveSender(profiles, input.match),
      };
    },

    async updateBroadcastSender(input) {
      return revision.reviseBroadcastDraft({
        workspace: input.workspace,
        draftId: input.draftId,
        baseRevision: input.baseRevision,
        operationId: input.operationId,
        changes: {
          sender: input.senderProfileId,
          ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
        },
      });
    },
  };
}

function senderCatalogReceipt(
  value: unknown,
): readonly BroadcastSenderProfile[] {
  const root = record(value);
  if (
    root.environment !== "production" ||
    !Array.isArray(root.senderProfiles)
  ) {
    invalidReceipt();
  }
  const profiles = root.senderProfiles.map(senderProfile);
  if (
    new Set(profiles.map((profile) => profile.sender_profile_id)).size !==
    profiles.length
  )
    invalidReceipt();
  return profiles;
}

function senderProfile(value: unknown): BroadcastSenderProfile {
  const profile = record(value);
  exactKeys(profile, [
    "senderId",
    "fromName",
    "emailAddress",
    "defaultReplyTo",
  ]);
  return {
    sender_profile_id: identifier(profile.senderId, 200),
    name: identifier(profile.fromName, 120),
    email: email(profile.emailAddress),
    default_reply_to: email(profile.defaultReplyTo),
  };
}

function resolveSender(
  profiles: readonly BroadcastSenderProfile[],
  match: string | null,
): BroadcastSenderResolution {
  const candidates =
    match === null
      ? profiles
      : profiles.filter((profile) => {
          const expected = match.toLowerCase();
          return (
            profile.name.toLowerCase() === expected ||
            profile.email.toLowerCase() === expected
          );
        });
  const ids = candidates.map((profile) => profile.sender_profile_id);
  if (ids.length === 1) {
    return {
      outcome: "selected",
      sender_profile_id: ids[0]!,
      candidate_sender_profile_ids: ids,
    };
  }
  return {
    outcome: ids.length === 0 ? "not_found" : "ambiguous",
    sender_profile_id: null,
    candidate_sender_profile_ids: ids,
  };
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key) => !expected.includes(key))
  )
    invalidReceipt();
}

function identifier(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /\p{Cc}/u.test(value)
  )
    invalidReceipt();
  return value;
}

function email(value: unknown): string {
  const result = identifier(value, 320);
  const parts = result.split("@");
  if (
    result !== result.toLowerCase() ||
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1]?.includes(".") ||
    /\s/u.test(result)
  )
    invalidReceipt();
  return result;
}

function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${encodeURIComponent(workspace)}`;
}
