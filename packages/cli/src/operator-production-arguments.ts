import { parseProductionDraftCreate } from "./operator-production-draft-arguments.js";
import {
  content,
  idempotencyKey,
  isProduction,
  operatorArguments,
  positiveInteger,
  productionRead,
  required,
  reuseOverride,
  uuid,
  workspace,
} from "./operator-production-options.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

export function parseProductionOperatorArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "broadcast") return null;
  if (argv[1] === "draft" && argv[2] === "create") {
    return parseProductionDraftCreate(argv.slice(3));
  }
  if (argv[1] === "draft" && argv[2] === "read") {
    return draftRead(argv.slice(3));
  }
  if (argv[1] === "audience" && argv[2] === "options") {
    return audienceOptions(argv.slice(3));
  }
  if (argv[1] === "audience" && argv[2] === "preview") {
    return audiencePreview(argv.slice(3));
  }
  if (argv[1] === "authorize") return authorize(argv.slice(2));
  if (argv[1] === "status") return progress(argv.slice(2));
  if (argv[1] === "pause" || argv[1] === "resume" || argv[1] === "cancel") {
    return control(argv[1], argv.slice(2));
  }
  if (argv[1] === "result") return result(argv.slice(2));
  if (argv[1] === "test" && argv[2] === "send" && isProduction(argv.slice(3))) {
    return productionTestSend(argv.slice(3));
  }
  if (
    argv[1] === "test" &&
    argv[2] === "status" &&
    isProduction(argv.slice(3))
  ) {
    return productionTestStatus(argv.slice(3));
  }
  return null;
}

function draftRead(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, ["--draft-id"]);
  return operatorArguments(options, {
    kind: "broadcast_draft_read",
    workspace: workspace(options),
    draftId: uuid(required(options, "--draft-id")),
  });
}

function audienceOptions(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv);
  return operatorArguments(options, {
    kind: "broadcast_audience_options",
    workspace: workspace(options),
  });
}

function audiencePreview(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, ["--draft-id"]);
  return operatorArguments(options, {
    kind: "broadcast_audience_preview",
    workspace: workspace(options),
    draftId: uuid(required(options, "--draft-id")),
  });
}

function productionTestSend(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, [
    "--draft-id",
    "--revision",
    "--postal-address",
    "--idempotency-key",
  ]);
  return operatorArguments(options, {
    kind: "broadcast_production_test_send",
    workspace: workspace(options),
    draftId: uuid(required(options, "--draft-id")),
    revision: positiveInteger(required(options, "--revision")),
    postalAddress: content(required(options, "--postal-address"), 2_000),
    idempotencyKey: idempotencyKey(required(options, "--idempotency-key")),
  });
}

function productionTestStatus(
  argv: readonly string[],
): ParsedOperatorArguments {
  const options = productionRead(
    argv,
    ["--draft-id", "--test-id"],
    [],
    ["--watch"],
  );
  return operatorArguments(options, {
    kind: "broadcast_production_test_status",
    workspace: workspace(options),
    draftId: uuid(required(options, "--draft-id")),
    testId: uuid(required(options, "--test-id")),
    watch: options.flags.has("--watch"),
  });
}

function authorize(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, [
    "--draft-id",
    "--revision",
    "--postal-address",
    "--idempotency-key",
    "--acknowledge-audience-reuse",
  ]);
  return operatorArguments(options, {
    kind: "broadcast_authorize",
    workspace: workspace(options),
    draftId: uuid(required(options, "--draft-id")),
    revision: positiveInteger(required(options, "--revision")),
    postalAddress: content(required(options, "--postal-address"), 2_000),
    idempotencyKey: idempotencyKey(required(options, "--idempotency-key")),
    audienceReuseOverride: reuseOverride(options),
  });
}

function progress(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, ["--broadcast-id"], [], ["--watch"]);
  return operatorArguments(options, {
    kind: "broadcast_progress",
    workspace: workspace(options),
    broadcastId: uuid(required(options, "--broadcast-id")),
    watch: options.flags.has("--watch"),
  });
}

function control(
  name: "pause" | "resume" | "cancel",
  argv: readonly string[],
): ParsedOperatorArguments {
  const options = productionRead(argv, ["--broadcast-id"]);
  return operatorArguments(options, {
    kind: "broadcast_control",
    workspace: workspace(options),
    broadcastId: uuid(required(options, "--broadcast-id")),
    operation: name === "cancel" ? "cancel_remaining" : name,
  });
}

function result(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, ["--broadcast-id"]);
  return operatorArguments(options, {
    kind: "broadcast_result",
    workspace: workspace(options),
    broadcastId: uuid(required(options, "--broadcast-id")),
  });
}
