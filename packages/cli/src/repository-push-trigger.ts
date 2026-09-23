import type { CapturedCommandRunner, CommandResult } from "./runtime-types.js";

export const REPOSITORY_PUSH_EVENT_VERSION = "fonte.repository_push.v1" as const;

const commitShaPattern = /^[0-9a-f]{40}$/u;
const zeroSha = "0".repeat(40);
const mainRef = "refs/heads/main";

export interface RepositoryPushEvent {
  schemaVersion: typeof REPOSITORY_PUSH_EVENT_VERSION;
  deliveryId: string;
  repository: { url: string };
  ref: string;
  before: string;
  after: string;
  receivedAt: string;
}

/** Provider-specific code must authenticate a delivery before returning this event. */
export interface RepositoryPushAuthenticator {
  authenticate(delivery: unknown): Promise<unknown>;
}

export interface RepositoryPushTriggerDependencies {
  cwd: string;
  expectedRepositoryUrl: string;
  runner: CapturedCommandRunner;
  authenticator: RepositoryPushAuthenticator;
  /** FON-749 consumes the same event for non-main candidate qualification. */
  qualifyCandidate(event: RepositoryPushEvent): Promise<CommandResult>;
}

/**
 * Normalize and dispatch one authenticated provider delivery. Main pushes call
 * the installed `fonte release` CLI with the event's exact commit. Other branch
 * pushes go to the qualification consumer without changing the event identity.
 */
export async function dispatchRepositoryPush(
  delivery: unknown,
  dependencies: RepositoryPushTriggerDependencies,
): Promise<CommandResult> {
  let event: RepositoryPushEvent;
  try {
    const authenticated = await dependencies.authenticator.authenticate(delivery);
    const parsed = parseRepositoryPushEvent(authenticated);
    if ("blocked" in parsed) return parsed.blocked;
    event = parsed.event;
  } catch {
    return blocked("event_authentication_failed");
  }

  const expectedRepository = canonicalRepositoryUrl(dependencies.expectedRepositoryUrl);
  const eventRepository = canonicalRepositoryUrl(event.repository.url);
  if (!expectedRepository || eventRepository !== expectedRepository) {
    return blocked("repository_mismatch");
  }

  let remote: { exitCode: number; stdout: string; stderr: string };
  try {
    remote = await dependencies.runner.run(
      "git",
      ["remote", "get-url", "origin"],
      dependencies.cwd,
    );
  } catch {
    return blocked("repository_unavailable");
  }
  if (
    remote.exitCode !== 0 ||
    canonicalRepositoryUrl(remote.stdout.trim()) !== expectedRepository
  ) {
    return blocked("repository_mismatch");
  }

  try {
    if (event.ref === mainRef) {
      return normalizeCommandResult(await dependencies.runner.run(
        "fonte",
        ["release", "--source", event.after],
        dependencies.cwd,
      ));
    }
    if (typeof dependencies.qualifyCandidate !== "function") {
      return blocked("candidate_qualifier_unavailable");
    }
    return normalizeCommandResult(await dependencies.qualifyCandidate(event));
  } catch {
    return { exitCode: 1, stdout: "", stderr: "Fonte failed: execution_failed.\n" };
  }
}

function parseRepositoryPushEvent(
  value: unknown,
): { event: RepositoryPushEvent } | { blocked: CommandResult } {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "deliveryId", "repository", "ref", "before", "after", "receivedAt",
  ])) return { blocked: blocked("invalid_push_event") };
  if (
    value.schemaVersion !== REPOSITORY_PUSH_EVENT_VERSION ||
    typeof value.deliveryId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/u.test(value.deliveryId) ||
    !isRecord(value.repository) || !hasExactKeys(value.repository, ["url"]) ||
    typeof value.repository.url !== "string" ||
    !canonicalRepositoryUrl(value.repository.url) ||
    typeof value.ref !== "string" || !isBranchRef(value.ref) ||
    typeof value.before !== "string" ||
    (value.before !== zeroSha && !commitShaPattern.test(value.before)) ||
    typeof value.after !== "string" || !commitShaPattern.test(value.after) ||
    value.after === zeroSha ||
    typeof value.receivedAt !== "string" || Number.isNaN(Date.parse(value.receivedAt))
  ) return { blocked: blocked("invalid_push_event") };
  return { event: value as unknown as RepositoryPushEvent };
}

function isBranchRef(ref: string): boolean {
  if (!ref.startsWith("refs/heads/")) return false;
  const branch = ref.slice("refs/heads/".length);
  if (!/^[A-Za-z0-9._/-]{1,255}$/u.test(branch) || branch.includes("//") || branch.endsWith("/")) {
    return false;
  }
  return branch.split("/").every((part) =>
    part.length > 0 && part !== "." && part !== ".." && !part.startsWith(".") && !part.endsWith(".lock")
  );
}

function canonicalRepositoryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.search || url.hash
    ) return undefined;
    const path = url.pathname.replace(/\/+$/u, "").replace(/\.git$/u, "");
    if (!path || path === "/" || path.split("/").some((part) => part === "." || part === "..")) {
      return undefined;
    }
    return `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function normalizeCommandResult(result: { exitCode: number; stdout: string; stderr: string }): CommandResult {
  return {
    exitCode: result.exitCode === 0 ? 0 : result.exitCode === 2 || result.exitCode === 3 ? result.exitCode : 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function blocked(reason: string): CommandResult {
  return {
    exitCode: 3,
    stdout: `${JSON.stringify({ status: "BLOCKED", reason })}\n`,
    stderr: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
