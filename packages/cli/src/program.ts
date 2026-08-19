import { parseArguments } from "./arguments.js";
import {
  AUTHORIZATION_ERROR_TEXT,
  EXECUTION_ERROR_TEXT,
  HELP_TEXT,
  LOCAL_MANIFEST_PATH,
  ROLLBACK_ERROR_TEXT,
  USAGE_TEXT,
  VERSION_TEXT,
} from "./constants.js";
import { runAuthorizedConsumer } from "./auth-exec.js";
import { verifyInstallation } from "./doctor.js";
import { CliBlockedError, CliExecutionError, CliUsageError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { createInitPlan, createRemovePlan } from "./installation-plan.js";
import { readManifest } from "./manifest.js";
import { applyInit, applyRemove } from "./mutations.js";
import { runHostedTest, testBlockedReceipt } from "./hosted-test.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { assertManagedPathSafe } from "./paths.js";
import { detectProject } from "./project.js";
import { blockedReceipt, plannedReceipt } from "./receipts.js";
import { renderHuman, renderJson } from "./render.js";
import type { CommandResult, ProgramDependencies } from "./runtime-types.js";
import type { AnyCliReceipt, CommandName, ParsedArguments } from "./types.js";

/** Execute one parsed CLI request; never write directly to stdout or stderr. */
export async function runProgram(
  argv: readonly string[],
  dependencies: ProgramDependencies,
): Promise<CommandResult> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return { exitCode: 2, stdout: "", stderr: USAGE_TEXT };
    }
    return executionFailure();
  }
  if (parsed.command === "help") {
    return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  }
  if (parsed.command === "version") {
    return { exitCode: 0, stdout: VERSION_TEXT, stderr: "" };
  }
  if (parsed.command === "auth-exec") {
    return executeAuthExec(parsed, dependencies);
  }
  const request = { ...parsed, command: parsed.command };
  try {
    const profile = await detectProject(dependencies.cwd);
    const receipt = await executeCommand(request, profile, dependencies);
    return receiptResult(receipt, parsed.json, receiptExitCode(receipt));
  } catch (error) {
    if (error instanceof CliBlockedError) {
      if (parsed.command === "test") {
        return receiptResult(
          testBlockedReceipt(
            parsed.workspaceSlug ?? "unavailable",
            error.reason,
            "failed",
          ),
          parsed.json,
          3,
        );
      }
      return receiptResult(
        blockedReceipt(parsed.command, error.reason),
        parsed.json,
        3,
      );
    }
    if (error instanceof CliExecutionError) {
      return executionFailure(error.reason === "rollback_failed");
    }
    return executionFailure();
  }
}

async function executeAuthExec(
  parsed: ParsedArguments,
  dependencies: ProgramDependencies,
): Promise<CommandResult> {
  if (!dependencies.authExec) return authorizationFailure();
  try {
    await runAuthorizedConsumer(
      parsed.consumerCommand!,
      parsed.consumerArguments!,
      dependencies.authExec,
    );
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (error) {
    if (error instanceof HostedTestBlockedError) return authorizationFailure();
    return executionFailure();
  }
}

function authorizationFailure(): CommandResult {
  return { exitCode: 3, stdout: "", stderr: AUTHORIZATION_ERROR_TEXT };
}

function receiptExitCode(receipt: AnyCliReceipt): 0 | 3 {
  if (receipt.schema_version !== "fonte.cli.test_receipt.v1") return 0;
  return receipt.outcome === "terminal" &&
    receipt.provider_submission === "accepted"
    ? 0
    : 3;
}

async function executeCommand(
  parsed: ParsedArguments & { command: CommandName },
  profile: Awaited<ReturnType<typeof detectProject>>,
  dependencies: ProgramDependencies,
): Promise<AnyCliReceipt> {
  if (parsed.command === "init") {
    if (await manifestExists(profile.root)) {
      return verifyInstallation(profile, await readManifest(profile.root));
    }
    const plan = await createInitPlan(profile);
    return parsed.apply
      ? applyInit(profile, plan, dependencies.randomUUID(), dependencies.runner)
      : plannedReceipt(plan);
  }
  const manifest = await readManifest(profile.root);
  if (parsed.command === "doctor") {
    return verifyInstallation(profile, manifest);
  }
  if (parsed.command === "test") {
    await verifyInstallation(profile, manifest);
    if (!dependencies.hosted)
      return testBlockedReceipt(
        parsed.workspaceSlug!,
        "hosted_test_unavailable",
      );
    return runHostedTest(
      parsed.workspaceSlug!,
      dependencies.randomUUID(),
      dependencies.hosted,
    );
  }
  const plan = await createRemovePlan(profile, manifest);
  return parsed.apply
    ? applyRemove(profile, plan, dependencies.runner)
    : plannedReceipt(plan);
}

async function manifestExists(root: string): Promise<boolean> {
  const target = await assertManagedPathSafe(root, LOCAL_MANIFEST_PATH);
  return Boolean(await readOptional(target));
}

function receiptResult(
  receipt: AnyCliReceipt,
  json: boolean,
  exitCode: 0 | 3 = 0,
): CommandResult {
  return {
    exitCode,
    stdout: json ? renderJson(receipt) : renderHuman(receipt),
    stderr: "",
    receipt,
  };
}

function executionFailure(rollbackFailed = false): CommandResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: rollbackFailed ? ROLLBACK_ERROR_TEXT : EXECUTION_ERROR_TEXT,
  };
}
