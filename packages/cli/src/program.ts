import { parseArguments } from "./arguments.js";
import {
  EXECUTION_ERROR_TEXT,
  HELP_TEXT,
  LOCAL_MANIFEST_PATH,
  ROLLBACK_ERROR_TEXT,
  USAGE_TEXT,
  VERSION_TEXT,
} from "./constants.js";
import { verifyInstallation } from "./doctor.js";
import { CliBlockedError, CliExecutionError, CliUsageError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { createInitPlan, createRemovePlan } from "./installation-plan.js";
import { readManifest } from "./manifest.js";
import { applyInit, applyRemove } from "./mutations.js";
import { assertManagedPathSafe } from "./paths.js";
import { detectProject } from "./project.js";
import { blockedReceipt, plannedReceipt } from "./receipts.js";
import { renderHuman, renderJson } from "./render.js";
import type { CommandResult, ProgramDependencies } from "./runtime-types.js";
import type { CliReceipt, CommandName, ParsedArguments } from "./types.js";

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
  const request = { ...parsed, command: parsed.command };
  try {
    const profile = await detectProject(dependencies.cwd);
    const receipt = await executeCommand(request, profile, dependencies);
    return receiptResult(receipt, parsed.json);
  } catch (error) {
    if (error instanceof CliBlockedError) {
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

async function executeCommand(
  parsed: ParsedArguments & { command: CommandName },
  profile: Awaited<ReturnType<typeof detectProject>>,
  dependencies: ProgramDependencies,
): Promise<CliReceipt> {
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
  receipt: CliReceipt,
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
