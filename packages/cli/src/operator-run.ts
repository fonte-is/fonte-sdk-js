import type { HostedConfig } from "./hosted-config.js";
import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  createCoreOperatorClient,
  CoreOperatorError,
} from "./operator-client.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
  SandboxTestResult,
} from "./operator-types.js";

export interface OperatorDependencies {
  readonly configUrl?: string;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  authorize(config: HostedConfig): Promise<string>;
  sleep(milliseconds: number): Promise<void>;
}

export async function runOperatorCommand(
  command: OperatorCommand,
  dependencies: OperatorDependencies,
): Promise<OperatorReceipt> {
  if (command.kind === "unsupported") return unsupportedReceipt();
  try {
    const config = await loadHostedConfig(
      dependencies.fetch as typeof fetch,
      dependencies.configUrl,
    );
    const bearer = await dependencies.authorize(config);
    const client = createCoreOperatorClient({
      coreApiBaseUrl: config.coreApiBaseUrl,
      bearer,
      fetch: dependencies.fetch as typeof fetch,
    });
    const result = await execute(command, client, dependencies.sleep);
    return successReceipt(command, result);
  } catch (error) {
    const core = error instanceof CoreOperatorError ? error : null;
    return {
      schema_version: "fonte.cli.operator_receipt.v1",
      command: command.kind,
      outcome: "blocked",
      reason:
        core?.reason ??
        (error instanceof HostedTestBlockedError
          ? error.reason
          : "operator_request_failed"),
      workspace: command.workspace,
      authority: currentAuthority(command),
      core_effect: core?.coreEffect ?? "none",
      result: null,
    };
  }
}

async function execute(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  client: ReturnType<typeof createCoreOperatorClient>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OperatorResult> {
  if (command.kind === "broadcast_test_send") {
    return client.sendSandboxTest({
      workspace: command.workspace,
      draftId: command.draftId,
      revision: command.revision,
      idempotencyKey: command.idempotencyKey,
    });
  }
  if (command.kind === "broadcast_test_status") {
    const read = () =>
      client.readSandboxTest({
        workspace: command.workspace,
        testId: command.testId,
      });
    return command.watch ? poll(read, sleep) : read();
  }
  if (command.kind === "bridge_resend_preview") {
    return client.previewResendSegment({
      workspace: command.workspace,
      environment: command.environment,
      segmentId: command.segmentId,
    });
  }
  return client.copyResendSegment({
    workspace: command.workspace,
    environment: command.environment,
    segmentId: command.segmentId,
    expectedObservationFingerprint: command.observationFingerprint,
    idempotencyKey: command.idempotencyKey,
  });
}

async function poll(
  read: () => Promise<SandboxTestResult>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<SandboxTestResult> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await read();
    if (result.status === "terminal") return result;
    await sleep(Math.min(result.poll_after_milliseconds ?? 1_000, 2_000));
  }
  throw new CoreOperatorError("core_readback_timeout", null, "none");
}

function successReceipt(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
): OperatorReceipt {
  if (result.kind === "resend_bridge_preview") {
    return currentReceipt(
      command,
      result,
      "completed",
      `resend_bridge_observation_${result.pagination.status}`,
      "none",
    );
  }
  if (result.kind === "resend_bridge_copy") {
    return currentReceipt(
      command,
      result,
      "completed",
      result.import_receipt.created
        ? "resend_bridge_copy_completed"
        : "resend_bridge_copy_idempotent",
      result.import_receipt.created ? "copied" : "none",
    );
  }
  return currentReceipt(
    command,
    result,
    result.status === "queued"
      ? "queued"
      : result.status === "terminal"
        ? "terminal"
        : "completed",
    `sandbox_test_${result.status}`,
    result.status === "queued" ? "queued" : "none",
  );
}

function currentReceipt(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
  outcome: "queued" | "terminal" | "completed",
  reason: string,
  coreEffect: "none" | "queued" | "copied",
): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome,
    reason,
    workspace: command.workspace,
    authority: currentAuthority(command),
    core_effect: coreEffect,
    result,
  };
}

function unsupportedReceipt(): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: "unsupported",
    outcome: "unsupported_authority",
    reason: "unsupported_authority",
    workspace: null,
    authority: { status: "missing", contract_id: "unavailable" },
    core_effect: "none",
    result: null,
  };
}

function currentAuthority(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
): OperatorReceipt["authority"] {
  return {
    status: "current",
    contract_id: command.kind.startsWith("bridge_resend_")
      ? "fonte.core.resend_bridge.v1"
      : "fonte.core.sandbox_canary.v1",
  };
}
