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
    const result =
      command.kind === "broadcast_test_send"
        ? await client.sendSandboxTest({
            workspace: command.workspace,
            draftId: command.draftId,
            revision: command.revision,
            idempotencyKey: command.idempotencyKey,
          })
        : command.watch
          ? await poll(
              () =>
                client.readSandboxTest({
                  workspace: command.workspace,
                  testId: command.testId,
                }),
              dependencies.sleep,
            )
          : await client.readSandboxTest({
              workspace: command.workspace,
              testId: command.testId,
            });
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
      authority: currentAuthority(),
      core_effect: core?.coreEffect ?? "none",
      result: null,
    };
  }
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
  result: SandboxTestResult,
): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome:
      result.status === "queued"
        ? "queued"
        : result.status === "terminal"
          ? "terminal"
          : "completed",
    reason: `sandbox_test_${result.status}`,
    workspace: command.workspace,
    authority: currentAuthority(),
    core_effect: result.status === "queued" ? "queued" : "none",
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

function currentAuthority(): OperatorReceipt["authority"] {
  return {
    status: "current",
    contract_id: "fonte.core.sandbox_canary.v1",
  };
}
