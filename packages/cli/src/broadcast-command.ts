import type { BroadcastClientOptions } from "./broadcast-client.js";
import {
  createBroadcastClient,
  waitForBroadcastOperation,
} from "./broadcast-client.js";
import type {
  BroadcastReceipt,
  BroadcastReviewRequest,
  BroadcastScope,
  SavedBroadcastRequest,
} from "./broadcast-contracts.js";
import { CoreOperatorError } from "./operator-core-request.js";
import {
  broadcastScopeSchema,
  broadcastUuid,
  parseBroadcastReviewRequest,
  parseSavedBroadcastRequest,
  request,
} from "./broadcast-validation.js";
import {
  sequenceMcpFailure,
  type SequenceMcpFailure,
} from "./mcp-sequence-failure.js";

export type BroadcastCommand = (
  | {
      readonly kind: "broadcast_bg_review";
      readonly scope: BroadcastScope;
      readonly input: BroadcastReviewRequest;
    }
  | {
      readonly kind: "broadcast_bg_send";
      readonly input: SavedBroadcastRequest;
    }
  | {
      readonly kind: "broadcast_bg_recover";
      readonly scope: BroadcastScope;
      readonly requestId: string;
    }
  | {
      readonly kind: "broadcast_bg_read";
      readonly scope: BroadcastScope;
      readonly operationUri: string;
      readonly operationKind: "review" | "send";
    }
) & {
  readonly json: boolean;
  readonly requestTimeoutMs: number;
  readonly foregroundWaitMs: number;
};
export type BroadcastCommandResult =
  | {
      readonly outcome: "observed" | "pending";
      readonly reason: string;
      readonly request_id: string | null;
      readonly operation: BroadcastReceipt;
    }
  | (SequenceMcpFailure & {
      readonly request_id: string | null;
      readonly operation: null;
    });

/** Composition seam for the actual CLI parser. Existing schedule/control spellings fall through.
 * Retired send now never maps to this normal review/Send path. */
export function parseBroadcastArguments(
  argv: readonly string[],
): BroadcastCommand | null {
  if (argv[0] === "--json") argv = [...argv.slice(1), "--json"];
  if (argv[0] !== "broadcast") return null;
  const action = argv[1];
  if (action !== "review" && action !== "operation" && action !== "send")
    return null;
  if (action === "send" && argv[2] !== "recover" && !argv[2]?.startsWith("--"))
    return null;
  const recover = action === "send" && argv[2] === "recover";
  const opts = options(argv.slice(recover ? 3 : 2));
  const common = {
    json: opts.json,
    requestTimeoutMs: integer(opts, "--request-timeout-ms", 60_000, 1),
    foregroundWaitMs: integer(opts, "--wait-ms", 0, 0),
  };
  if (action === "send" && !recover) {
    const input = request(
      () =>
        parseSavedBroadcastRequest(JSON.parse(required(opts, "--send-input"))),
      "broadcast_saved_input_recover_review_required",
    );
    if (input.request.schema !== "broadcast_send_request.v2")
      throw new CoreOperatorError("broadcast_review_required", null, "none");
    only(opts, ["--send-input", "--request-timeout-ms", "--wait-ms"]);
    return { kind: "broadcast_bg_send", input, ...common };
  }
  const scope = request(() =>
    broadcastScopeSchema.parse({
      workspace: required(opts, "--workspace"),
      environment: required(opts, "--environment"),
      draftId: required(opts, "--draft-id"),
    }),
  );
  const base = [
    "--workspace",
    "--environment",
    "--draft-id",
    "--request-timeout-ms",
    "--wait-ms",
  ];
  if (recover) {
    only(opts, [...base, "--request-id"]);
    const requestId = request(() =>
      broadcastUuid.parse(required(opts, "--request-id")),
    );
    return { kind: "broadcast_bg_recover", scope, requestId, ...common };
  }
  if (action === "review") {
    only(opts, [
      ...base,
      "--request-id",
      "--expected-version",
      "--audience-mode",
    ]);
    const input = parseBroadcastReviewRequest({
      schema: "broadcast_review_request.v1",
      requestId: required(opts, "--request-id"),
      expectedDraftVersion: integer(opts, "--expected-version", undefined, 1),
      audienceMode: opts.values.get("--audience-mode") ?? "reuse_compatible",
    });
    return { kind: "broadcast_bg_review", scope, input, ...common };
  }
  only(opts, [...base, "--operation-uri", "--kind"]);
  const operationKind = required(opts, "--kind");
  if (operationKind !== "review" && operationKind !== "send") invalid();
  return {
    kind: "broadcast_bg_read",
    scope,
    operationKind,
    operationUri: required(opts, "--operation-uri"),
    ...common,
  };
}
export async function runBroadcastCommand(
  command: BroadcastCommand,
  dependencies: BroadcastClientOptions & {
    readonly sleep: (milliseconds: number) => Promise<void>;
    readonly now?: () => number;
  },
): Promise<BroadcastCommandResult> {
  const requestId =
    command.kind === "broadcast_bg_send"
      ? command.input.request.requestId
      : command.kind === "broadcast_bg_review"
        ? command.input.requestId
        : command.kind === "broadcast_bg_recover"
          ? command.requestId
          : null;
  try {
    const client = createBroadcastClient({
      ...dependencies,
      requestTimeoutMs: command.requestTimeoutMs,
    });
    let scope: BroadcastScope;
    let initial: BroadcastReceipt;
    let expectedDraftVersion: number | undefined;
    if (command.kind === "broadcast_bg_send") {
      if (
        command.input.coreOrigin !==
          new URL(dependencies.coreApiBaseUrl).origin ||
        command.input.request.schema !== "broadcast_send_request.v2"
      )
        invalid();
      scope = command.input;
      expectedDraftVersion = command.input.request.expectedDraftVersion;
      initial = await client.send(scope, command.input.request);
    } else if (command.kind === "broadcast_bg_recover") {
      scope = command.scope;
      const saved = await dependencies.store.read(command.requestId);
      expectedDraftVersion = saved.request.expectedDraftVersion;
      if (
        saved.workspace !== scope.workspace ||
        saved.environment !== scope.environment ||
        saved.draftId !== scope.draftId
      )
        throw new CoreOperatorError(
          "broadcast_saved_input_scope_conflict",
          null,
          "none",
        );
      initial = await client.recover(command.requestId);
    } else if (command.kind === "broadcast_bg_review") {
      scope = command.scope;
      expectedDraftVersion = command.input.expectedDraftVersion;
      initial = await client.review(scope, command.input);
    } else {
      scope = command.scope;
      initial =
        command.operationKind === "review"
          ? await client.readReview(scope, command.operationUri)
          : await client.readSend(scope, command.operationUri);
    }
    const result = await waitForBroadcastOperation(client, scope, initial, {
      foregroundWaitMs: command.foregroundWaitMs,
      sleep: dependencies.sleep,
      now: dependencies.now,
      expectedDraftVersion,
    });
    return {
      outcome: result.pending ? "pending" : "observed",
      request_id: requestId,
      reason: operationReason(result.receipt),
      operation: result.receipt,
    };
  } catch (error) {
    return {
      ...sequenceMcpFailure(error),
      request_id: requestId,
      operation: null,
    };
  }
}
export function renderBroadcastCommand(
  result: BroadcastCommandResult,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(result)}\n`;
  if (!result.operation)
    return `${result.reason}. Request ${result.request_id ?? "unknown"}; Core effect ${result.core_effect}.\n`;
  const receipt = result.operation;
  const state =
    "state" in receipt
      ? `Review ${receipt.state}`
      : receipt.outcome === "executable"
        ? `Executable job ${receipt.jobId}`
        : receipt.outcome;
  const progress =
    "execution" in receipt && receipt.execution
      ? `; execution ${receipt.execution.state}`
      : "";
  const detail = receipt.blocker
    ? [receipt.blocker.stage, receipt.blocker.reason].filter(Boolean).join("/")
    : "";
  return `${state}${progress}. Operation ${receipt.operationId} version ${receipt.operationVersion}; ${result.reason}${detail ? ` (${detail})` : ""}.\n`;
}
function operationReason(receipt: BroadcastReceipt): string {
  return (
    receipt.blocker?.code ??
    ("state" in receipt
      ? `broadcast_review_${receipt.state}`
      : `broadcast_send_${receipt.outcome}`)
  );
}
interface Options {
  readonly json: boolean;
  readonly values: Map<string, string>;
}
function options(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (key === "--json" && !json) {
      json = true;
      continue;
    }
    const value = argv[++i];
    if (
      !key.startsWith("--") ||
      values.has(key) ||
      value === undefined ||
      value.startsWith("--")
    )
      invalid();
    values.set(key, value);
  }
  return { json, values };
}
function only(opts: Options, keys: readonly string[]): void {
  if ([...opts.values.keys()].some((key) => !keys.includes(key))) invalid();
}
function required(opts: Options, key: string): string {
  const value = opts.values.get(key);
  if (!value) invalid();
  return value;
}
function integer(
  opts: Options,
  key: string,
  fallback: number | undefined,
  minimum: number,
): number {
  const raw = opts.values.get(key);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !/^[0-9]+$/u.test(raw)) invalid();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647)
    invalid();
  return value;
}
function invalid(): never {
  throw new CoreOperatorError("broadcast_request_invalid", null, "none");
}
