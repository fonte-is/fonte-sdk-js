import { AsyncLocalStorage } from "node:async_hooks";

export type BroadcastDiagnosticPrefix = "prepare" | "send";

export type BroadcastDiagnosticStage =
  | "hosted_config"
  | "auth"
  | "workspace_catalog"
  | "draft_read"
  | "draft_create"
  | "draft_revision"
  | "sender_catalog"
  | "audience_options"
  | "recipient_set_read"
  | "recipient_set_create"
  | "recipient_set_poll"
  | "targeting_bind"
  | "final_draft_read"
  | "render"
  | "send_acceptance"
  | "send_readback";

export interface CoreRequestDiagnostic {
  readonly method: "GET" | "POST" | "PUT" | "PATCH";
  readonly route: string;
  readonly statusCode: number | null;
  readonly reason: string | null;
  readonly coreEffect: "none" | "unknown";
}

type CoreRequestAttempt = Omit<CoreRequestDiagnostic, "route"> & {
  readonly path: string;
};

interface StageRequest extends CoreRequestDiagnostic {
  readonly attempt: number;
}

interface ActiveStage {
  readonly diagnostics: BroadcastDiagnostics;
  readonly name: BroadcastDiagnosticStage;
  readonly attempt: number;
  readonly startedAt: number;
  readonly requests: StageRequest[];
}

const diagnosticsStorage = new AsyncLocalStorage<BroadcastDiagnostics>();
const stageStorage = new AsyncLocalStorage<ActiveStage>();
const MAX_REQUESTS_PER_STAGE = 8;
const MAX_STAGE_LINES = 32;

export class BroadcastDiagnostics {
  readonly #startedAt = performance.now();
  readonly #lines: string[] = [];
  #failedAt: BroadcastDiagnosticStage | null = null;
  #finished = false;

  constructor(readonly prefix: BroadcastDiagnosticPrefix) {}

  recordStage(
    stage: ActiveStage,
    error: unknown,
    expectedFailure = false,
  ): void {
    if (this.#finished || this.#lines.length >= MAX_STAGE_LINES) return;

    const elapsedMs = elapsed(stage.startedAt);
    const nestedFailure =
      this.#failedAt !== null && this.#failedAt !== stage.name;
    const coreError = error instanceof Error ? error : null;
    const failure = safeFailure(coreError);
    if (error !== undefined && !expectedFailure && !nestedFailure) {
      this.#failedAt ??= stage.name;
    }

    const requests = stage.requests.slice(0, MAX_REQUESTS_PER_STAGE);
    if (requests.length === 0) {
      if (nestedFailure) return;
      this.#lines.push(
        this.#formatStage(
          stage.name,
          elapsedMs,
          null,
          failure?.statusCode ?? null,
          failure?.reason ?? null,
          failure?.coreEffect ?? "none",
          stage.attempt,
        ),
      );
      return;
    }

    for (const [index, request] of requests.entries()) {
      const isFinalRequest = index === requests.length - 1;
      const applyFailure = isFinalRequest && !nestedFailure ? failure : null;
      this.#lines.push(
        this.#formatStage(
          stage.name,
          elapsedMs,
          request,
          applyFailure?.statusCode ?? null,
          applyFailure?.reason ?? request.reason,
          applyFailure?.coreEffect ?? request.coreEffect,
          Math.max(stage.attempt, request.attempt),
        ),
      );
      if (this.#lines.length >= MAX_STAGE_LINES) break;
    }
  }

  output(): string {
    if (!this.#finished) {
      this.#finished = true;
      this.#lines.push(`${this.prefix}.total ${elapsed(this.#startedAt)}ms`);
      this.#lines.push(`${this.prefix}.failed_at ${this.#failedAt ?? "none"}`);
    }
    return this.#lines.length === 0 ? "" : `${this.#lines.join("\n")}\n`;
  }

  #formatStage(
    name: BroadcastDiagnosticStage,
    elapsedMs: number,
    request: CoreRequestDiagnostic | null,
    statusCode: number | null,
    reason: string | null,
    coreEffect: "none" | "unknown",
    attempt: number,
  ): string {
    const label = `${this.prefix}.${name}`.padEnd(34);
    const method = request?.method ?? "-";
    const route = request?.route ?? "-";
    const status = statusCode ?? request?.statusCode ?? "-";
    const reasonText = reason ? ` ${safeReason(reason)}` : "";
    const attemptText = attempt > 1 ? ` attempt=${attempt}` : "";
    return `${label} ${elapsedMs}ms  ${method} ${route} ${status}${reasonText} core_effect=${coreEffect}${attemptText}`;
  }
}

export function withBroadcastDiagnostics<T>(
  diagnostics: BroadcastDiagnostics | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return diagnostics
    ? diagnosticsStorage.run(diagnostics, operation)
    : operation();
}

export async function runBroadcastDiagnosticStage<T>(
  name: BroadcastDiagnosticStage,
  operation: () => Promise<T>,
  attempt = 1,
  isExpectedFailure: (error: unknown) => boolean = () => false,
): Promise<T> {
  const diagnostics = diagnosticsStorage.getStore();
  if (!diagnostics) return operation();

  const stage: ActiveStage = {
    diagnostics,
    name,
    attempt: validAttempt(attempt),
    startedAt: performance.now(),
    requests: [],
  };
  let failure: unknown;
  try {
    return await stageStorage.run(stage, operation);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    diagnostics.recordStage(
      stage,
      failure,
      failure !== undefined && isExpectedFailure(failure),
    );
  }
}

export function withBroadcastDiagnosticAttempt<T>(
  attempt: number,
  operation: () => Promise<T>,
): Promise<T> {
  const stage = stageStorage.getStore();
  if (!stage) return operation();
  return stageStorage.run(
    { ...stage, attempt: validAttempt(attempt) },
    operation,
  );
}

export function recordCoreRequestDiagnostic(
  request: CoreRequestAttempt,
): void {
  const stage = stageStorage.getStore();
  if (!stage || stage.requests.length >= MAX_REQUESTS_PER_STAGE) return;
  stage.requests.push({
    method: request.method,
    route: normalizeCoreRoute(request.path),
    statusCode: request.statusCode,
    reason: request.reason,
    coreEffect: request.coreEffect,
    attempt: stage.attempt,
  });
}

export function normalizeCoreRoute(path: string): string {
  const pathname = path.split(/[?#]/u, 1)[0] ?? "";
  if (pathname === "/.well-known/fonte-cli.json") return pathname;
  const dynamicSegments: Readonly<Record<string, string>> = {
    workspaces: "workspace",
    "broadcast-drafts": "draft_id",
    "recipient-sets": "recipient_set_id",
    "send-operations": "operation_id",
    "sender-profiles": "sender_profile_id",
    campaigns: "campaign_id",
    segments: "segment_id",
  };
  const segments = pathname.split("/");
  const normalized = segments
    .slice(0, 32)
    .map((segment, index) => {
      if (segment === "") return "";
      const previous = segments[index - 1] ?? "";
      const parameter = dynamicSegments[previous];
      if (parameter) return `:${parameter}`;
      if (
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(segment) ||
        segment.includes("@") ||
        !/^[a-z0-9_-]{1,64}$/iu.test(segment)
      ) {
        return ":id";
      }
      return segment;
    })
    .join("/");
  return normalized.length <= 240
    ? normalized
    : `${normalized.slice(0, 237)}...`;
}

function safeFailure(error: Error | null): {
  statusCode: number | null;
  reason: string;
  coreEffect: "none" | "unknown";
} | null {
  if (!error) return null;
  const reasonValue = (error as Error & { reason?: unknown }).reason;
  const effectValue = (error as Error & { coreEffect?: unknown }).coreEffect;
  return {
    statusCode:
      Number.isInteger(
        (error as Error & { statusCode?: unknown }).statusCode,
      ) &&
      Number((error as Error & { statusCode?: unknown }).statusCode) >= 100 &&
      Number((error as Error & { statusCode?: unknown }).statusCode) <= 599
        ? Number((error as Error & { statusCode?: unknown }).statusCode)
        : null,
    reason:
      typeof reasonValue === "string"
        ? safeReason(reasonValue)
        : "stage_failed",
    coreEffect: effectValue === "unknown" ? "unknown" : "none",
  };
}

function safeReason(reason: string): string {
  return /^[a-z0-9_]{1,100}$/iu.test(reason) ? reason : "stage_failed";
}

function elapsed(startedAt: number): number {
  const value = performance.now() - startedAt;
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function validAttempt(attempt: number): number {
  return Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
}
