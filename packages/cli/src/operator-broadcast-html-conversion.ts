import { inspectBroadcastHtml } from "./operator-broadcast-html-inspection.js";

const RESEND_UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export interface BroadcastHtmlConversion {
  readonly kind: "provider_token" | "provider_artifact" | "literal_fallback";
  readonly source: string;
  readonly replacement: string;
  readonly occurrences: number;
}

export interface BroadcastHtmlConversionInput {
  readonly postalAddressLiteral: string | null;
  readonly literalFallbacks: Readonly<Record<string, string>>;
}

export interface BroadcastHtmlConversionResult {
  readonly html: string;
  readonly conversions: readonly BroadcastHtmlConversion[];
  readonly unsupportedTokens: readonly string[];
  readonly unusedFallbacks: readonly string[];
  readonly postalAddressLiteralMissing: boolean;
}

export function convertBroadcastHtml(
  original: string,
  input: BroadcastHtmlConversionInput,
): BroadcastHtmlConversionResult {
  let html = original;
  const conversions: BroadcastHtmlConversion[] = [];
  html = replace(
    html,
    RESEND_UNSUBSCRIBE,
    "{{{unsubscribe_url}}}",
    "provider_token",
    conversions,
  );
  if (input.postalAddressLiteral) {
    html = replace(
      html,
      input.postalAddressLiteral,
      "{{{postal_address}}}",
      "provider_token",
      conversions,
    );
  }
  for (const artifact of [
    "<!--$-->",
    "<!--/$-->",
    "<!--html-->",
    "<!--head-->",
    "<!--body-->",
    "<!-- -->",
  ]) {
    html = replace(html, artifact, "", "provider_artifact", conversions);
  }
  html = html.replace(
    /\sdata-id=(?:"__react-email-column"|'__react-email-column')/giu,
    (source) => {
      conversions.push({
        kind: "provider_artifact",
        source,
        replacement: "",
        occurrences: 1,
      });
      return "";
    },
  );
  const unsupportedTokens = inspectBroadcastHtml(html).unsupported;
  const unusedFallbacks: string[] = [];
  for (const [token, fallback] of Object.entries(input.literalFallbacks)) {
    if (!unsupportedTokens.includes(token)) {
      unusedFallbacks.push(token);
      continue;
    }
    html = replace(html, token, fallback, "literal_fallback", conversions);
  }
  return {
    html,
    conversions: coalesce(conversions),
    unsupportedTokens,
    unusedFallbacks,
    postalAddressLiteralMissing:
      input.postalAddressLiteral !== null &&
      occurrences(original, input.postalAddressLiteral) === 0,
  };
}

function replace(
  value: string,
  source: string,
  replacement: string,
  kind: BroadcastHtmlConversion["kind"],
  conversions: BroadcastHtmlConversion[],
): string {
  const count = occurrences(value, source);
  if (count > 0)
    conversions.push({ kind, source, replacement, occurrences: count });
  return value.replaceAll(source, replacement);
}

function coalesce(
  values: BroadcastHtmlConversion[],
): BroadcastHtmlConversion[] {
  const result: BroadcastHtmlConversion[] = [];
  for (const value of values) {
    const prior = result.find(
      (item) =>
        item.kind === value.kind &&
        item.source === value.source &&
        item.replacement === value.replacement,
    );
    if (prior) {
      result[result.indexOf(prior)] = {
        ...prior,
        occurrences: prior.occurrences + value.occurrences,
      };
    } else result.push(value);
  }
  return result;
}

function occurrences(value: string, search: string): number {
  return search.length === 0 ? 0 : value.split(search).length - 1;
}
