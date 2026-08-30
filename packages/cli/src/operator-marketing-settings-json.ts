import type { WorkspaceMarketingSettingsResult } from "./operator-marketing-settings-types.js";

export function workspaceMarketingSettings(
  value: unknown,
): WorkspaceMarketingSettingsResult {
  const body = exactObject(value, [
    "workspaceId",
    "environment",
    "postalAddress",
    "updatedAt",
  ]);
  if (body.environment !== "sandbox" && body.environment !== "production") {
    invalid();
  }
  if (body.postalAddress === null || body.updatedAt === null) {
    if (body.postalAddress !== null || body.updatedAt !== null) invalid();
    return {
      kind: "workspace_marketing_settings",
      workspaceId: workspaceId(body.workspaceId),
      environment: body.environment,
      postalAddress: null,
      updatedAt: null,
    };
  }
  return {
    kind: "workspace_marketing_settings",
    workspaceId: workspaceId(body.workspaceId),
    environment: body.environment,
    postalAddress: postalAddress(body.postalAddress),
    updatedAt: instant(body.updatedAt),
  };
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const actualKeys = Object.keys(body).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    invalid();
  }
  return body;
}

function workspaceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 200 ||
    /\s|\p{C}/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function postalAddress(value: unknown): string {
  const normalized =
    typeof value === "string"
      ? value
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => line.trim().replace(/[\t ]+/g, " "))
          .filter(Boolean)
          .join("\n")
      : null;
  if (
    typeof value !== "string" ||
    !normalized ||
    value !== normalized ||
    value.length > 500 ||
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || value.length > 50) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
