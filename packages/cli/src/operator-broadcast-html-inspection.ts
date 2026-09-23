export interface BroadcastHtmlInspection {
  readonly unsupported: readonly string[];
  readonly malformed: boolean;
  readonly controlCharacter: boolean;
  readonly assets: readonly string[];
}

const SUPPORTED_SLOTS = [
  "{{{contact.email}}}",
  "{{{unsubscribe_url}}}",
  "{{{postal_address}}}",
] as const;

export function inspectBroadcastHtml(html: string): BroadcastHtmlInspection {
  const slots = html.match(/\{\{\{[^{}]+\}\}\}/gu) ?? [];
  const unsupported = [
    ...new Set(
      slots.filter(
        (slot) =>
          !SUPPORTED_SLOTS.includes(slot as (typeof SUPPORTED_SLOTS)[number]),
      ),
    ),
  ].sort();
  const withoutAllowed = SUPPORTED_SLOTS.reduce(
    (value, slot) => value.replaceAll(slot, ""),
    html,
  );
  const malformed =
    /\{\{\{?[A-Za-z_][A-Za-z0-9_.]*\}\}\}?/u.test(withoutAllowed) ||
    /\{\{\{?[A-Za-z_][A-Za-z0-9_.]*$/u.test(withoutAllowed);
  const controlCharacter =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(html);
  return { unsupported, malformed, controlCharacter, assets: assets(html) };
}

export function broadcastHtmlWarnings(
  html: string,
  hasReference: boolean,
): string[] {
  const warnings: string[] = [];
  if (!/font-family\s*:/iu.test(html))
    warnings.push("font_dependency_unverified");
  if (!hasReference) warnings.push("visual_reference_missing");
  return warnings;
}

function assets(html: string): string[] {
  const result: string[] = [];
  for (const match of html.matchAll(
    /<(img|script|audio|video|source|iframe|embed|object)\b[^>]*>/giu,
  )) {
    const tag = match[1]?.toLowerCase();
    const attribute = match[0].match(
      /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu,
    );
    const value = (
      attribute?.[1] ??
      attribute?.[2] ??
      attribute?.[3] ??
      ""
    ).trim();
    if (tag !== "img" || !/^https:\/\//iu.test(value)) {
      result.push(value || `<${tag}>`);
    }
  }
  for (const match of html.matchAll(
    /<link\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
  )) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value && !/^data:|^#/iu.test(value)) result.push(value);
  }
  if (/\s(?:background|poster|srcset)\s*=/iu.test(html)) {
    result.push("html_resource_attribute");
  }
  return [...new Set(result)].sort().slice(0, 100);
}
