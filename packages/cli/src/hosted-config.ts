import { HostedTestBlockedError } from "./hosted-errors.js";

export const HOSTED_CONFIG_URL = "https://fonte.is/.well-known/fonte-cli.json";

export interface HostedConfig {
  readonly schema: "fonte.cli.hosted_config.v1";
  readonly authorizationServer: string;
  readonly clientId: string;
  readonly coreApiBaseUrl: string;
  readonly redirectUri: "http://127.0.0.1:49671/callback";
  readonly scopes: readonly ["email"];
}

export async function loadHostedConfig(
  fetcher: typeof fetch,
): Promise<HostedConfig> {
  let response: Response;
  try {
    response = await fetcher(HOSTED_CONFIG_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HostedTestBlockedError("hosted_configuration_unavailable");
  }
  if (!response.ok)
    throw new HostedTestBlockedError("hosted_configuration_unavailable");
  const value: unknown = await response.json().catch(() => null);
  return parseHostedConfig(value);
}

export function parseHostedConfig(value: unknown): HostedConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (
    keys !==
    "authorizationServer,clientId,coreApiBaseUrl,redirectUri,schema,scopes"
  )
    return invalid();
  if (record.schema !== "fonte.cli.hosted_config.v1") return invalid();
  if (record.redirectUri !== "http://127.0.0.1:49671/callback")
    return invalid();
  if (
    !Array.isArray(record.scopes) ||
    record.scopes.length !== 1 ||
    record.scopes[0] !== "email"
  )
    return invalid();
  if (
    typeof record.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{8,200}$/.test(record.clientId)
  )
    return invalid();
  return {
    schema: record.schema,
    authorizationServer: secureUrl(record.authorizationServer),
    clientId: record.clientId,
    coreApiBaseUrl: secureUrl(record.coreApiBaseUrl),
    redirectUri: record.redirectUri,
    scopes: ["email"],
  };
}

function secureUrl(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return invalid();
  return url.toString().replace(/\/$/, "");
}

function invalid(): never {
  throw new HostedTestBlockedError("hosted_configuration_invalid");
}
