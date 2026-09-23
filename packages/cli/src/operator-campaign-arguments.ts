import { CliUsageError } from "./errors.js";
import type {
  CampaignEnvironment,
  CampaignOperatorCommand,
} from "./operator-campaign-types.js";

export interface ParsedCampaignArguments {
  readonly command: CampaignOperatorCommand;
  readonly json: boolean;
}

interface Options {
  readonly values: ReadonlyMap<string, string>;
  readonly json: boolean;
}

export function parseCampaignOperatorArguments(
  argv: readonly string[],
): ParsedCampaignArguments | null {
  if (argv[0] !== "campaign") return null;
  const operation = argv[1];
  if (operation === "list") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--limit",
      "--cursor",
      "--include-archived",
    ]);
    const command: CampaignOperatorCommand = {
      kind: "campaign_list",
      ...scope(options),
      ...(options.values.has("--limit")
        ? { limit: positive(options, "--limit", 50) }
        : {}),
      ...(options.values.has("--cursor")
        ? { cursor: bounded(options, "--cursor", 2_048) }
        : {}),
      ...(options.values.has("--include-archived")
        ? { includeArchived: explicitBoolean(options, "--include-archived") }
        : {}),
    };
    return parsed(command, options);
  }
  if (operation === "read") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--campaign-id",
    ]);
    return parsed(
      {
        kind: "campaign_read",
        ...scope(options),
        campaignId: uuid(options, "--campaign-id"),
      },
      options,
    );
  }
  if (operation === "create") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--campaign-id",
      "--operation-id",
      "--title",
      "--description",
    ]);
    const description = optionalText(options, "--description", 4_096);
    return parsed(
      {
        kind: "campaign_create",
        ...scope(options),
        campaignId: uuid(options, "--campaign-id"),
        operationId: uuid(options, "--operation-id"),
        title: title(options),
        ...(description === undefined ? {} : { description }),
      },
      options,
    );
  }
  if (operation === "update") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--campaign-id",
      "--operation-id",
      "--expected-revision",
      "--title",
      "--description",
      "--archived",
    ]);
    return parsed(
      {
        kind: "campaign_update",
        ...scope(options),
        campaignId: uuid(options, "--campaign-id"),
        operationId: uuid(options, "--operation-id"),
        expectedRevision: positive(options, "--expected-revision"),
        title: title(options),
        description: requiredTextAllowEmpty(options, "--description", 4_096),
        archived: explicitBoolean(options, "--archived"),
      },
      options,
    );
  }
  if (operation === "receipt") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--operation-id",
    ]);
    return parsed(
      {
        kind: "campaign_receipt",
        ...scope(options),
        operationId: uuid(options, "--operation-id"),
      },
      options,
    );
  }
  invalid("invalid_field", "campaign operation");
}

function parsed(
  command: CampaignOperatorCommand,
  options: Options,
): ParsedCampaignArguments {
  return { command, json: options.json };
}

function scope(options: Options): {
  readonly workspace: string;
  readonly environment: CampaignEnvironment;
} {
  const workspace = bounded(options, "--workspace", 63);
  if (
    workspace.length < 2 ||
    workspace.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u.test(workspace)
  )
    invalid("invalid_field", "--workspace");
  const environment = required(options, "--environment");
  if (environment !== "sandbox" && environment !== "production")
    invalid("invalid_field", "--environment");
  return { workspace, environment };
}

function parseOptions(
  argv: readonly string[],
  allowedOptions: readonly string[],
): Options {
  const allowed = new Set(allowedOptions);
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--json") {
      if (json) invalid("duplicate_field", name);
      json = true;
      continue;
    }
    if (!allowed.has(name)) invalid("unknown_field", name);
    if (values.has(name)) invalid("duplicate_field", name);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || value.includes("\0"))
      invalid("missing_field", name);
    values.set(name, value);
    index += 1;
  }
  return { values, json };
}

function required(options: Options, name: string): string {
  const value = options.values.get(name);
  if (value === undefined || !value.trim()) invalid("missing_field", name);
  return value;
}

function bounded(options: Options, name: string, maximumBytes: number): string {
  const value = required(options, name);
  if (
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid("invalid_field", name);
  return value;
}

function optionalText(
  options: Options,
  name: string,
  maximumBytes: number,
): string | undefined {
  const value = options.values.get(name);
  if (value === undefined) return undefined;
  if (
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid("invalid_field", name);
  return value;
}

function requiredTextAllowEmpty(
  options: Options,
  name: string,
  maximumBytes: number,
): string {
  const value = options.values.get(name);
  if (value === undefined) invalid("missing_field", name);
  if (
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid("invalid_field", name);
  return value;
}

function title(options: Options): string {
  const value = bounded(options, "--title", 4_096);
  if (
    value !== value.trim() ||
    Array.from(value).length < 1 ||
    Array.from(value).length > 100
  )
    invalid("invalid_field", "--title");
  return value;
}

function uuid(options: Options, name: string): string {
  const value = required(options, name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    invalid("invalid_field", name);
  return value;
}

function positive(
  options: Options,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = required(options, name);
  if (!/^[1-9][0-9]*$/u.test(value)) invalid("invalid_field", name);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum)
    invalid("invalid_field", name);
  return number;
}

function explicitBoolean(options: Options, name: string): boolean {
  const value = required(options, name);
  if (value !== "true" && value !== "false") invalid("invalid_field", name);
  return value === "true";
}

function invalid(
  kind: "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field",
  field: string,
): never {
  throw new CliUsageError("invalid_operator_arguments", { kind, field });
}
