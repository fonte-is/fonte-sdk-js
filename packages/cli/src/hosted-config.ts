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
  configUrl = HOSTED_CONFIG_URL,
): Promise<HostedConfig> {
  const localDiscovery = localDiscoveryUrl(configUrl);
  let response: Response;
  try {
    response = await fetcher(configUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HostedTestBlockedError("hosted_configuration_unavailable");
  }
  if (!response.ok)
    throw new HostedTestBlockedError("hosted_configuration_unavailable");
  const value: unknown = await response.json().catch(() => null);
  return parseHostedConfig(value, localDiscovery);
}

export function parseHostedConfig(
  value: unknown,
  allowLoopbackCore = false,
): HostedConfig {
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
    authorizationServer: secureUrl(record.authorizationServer, false),
    clientId: record.clientId,
    coreApiBaseUrl: secureUrl(record.coreApiBaseUrl, allowLoopbackCore),
    redirectUri: record.redirectUri,
    scopes: ["email"],
  };
}

function secureUrl(value: unknown, allowLoopbackHttp: boolean): string {
  if (typeof value !== "string") return invalid();
  const url = new URL(value);
  const loopbackHttp =
    allowLoopbackHttp &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !loopbackHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return invalid();
  return url.toString().replace(/\/$/, "");
}

function localDiscoveryUrl(value: string): boolean {
  if (value === HOSTED_CONFIG_URL) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/.well-known/fonte-cli.json" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return invalid();
  return true;
}

function invalid(): never {
  throw new HostedTestBlockedError("hosted_configuration_invalid");
}
