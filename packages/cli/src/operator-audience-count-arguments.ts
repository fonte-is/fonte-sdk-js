import { audienceCountInputSchema, type AudienceCountInput, type AudienceCountResultV1 } from "./broadcast-audience-count-client.js";
import { invalidProductionArguments, parseProductionOptions, required } from "./operator-production-options.js";

export interface AudienceCountArguments {
  readonly kind: "broadcast_audience_count";
  readonly input: AudienceCountInput;
  readonly json: boolean;
}

/** Parses the complete command without broadening the shared Send/operator argument union. */
export function parseAudienceCountArguments(argv: readonly string[]): AudienceCountArguments | null {
  if (argv[0] !== "broadcast" || argv[1] !== "audience-count") return null;
  const options = parseProductionOptions(argv.slice(2), ["--count-input"]);
  let value: unknown;
  try { value = JSON.parse(required(options, "--count-input")); }
  catch { invalidProductionArguments("invalid_field", "--count-input"); }
  const parsed = audienceCountInputSchema.safeParse(value);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(parsed.data.request)).length > 64 * 1024
    || parsed.data.request.recipientExpression.include.length === 0) {
    invalidProductionArguments("invalid_field", "--count-input");
  }
  return { kind: "broadcast_audience_count", input: parsed.data, json: options.json };
}

export function renderAudienceCountResult(result: AudienceCountResultV1, json: boolean): string {
  return json ? JSON.stringify({ outcome: "completed", count: result }) : `${result.recipientCount} recipients`;
}

export const AUDIENCE_COUNT_COMMAND_HELP = "fonte broadcast audience-count --count-input '<JSON>' [--json]";
