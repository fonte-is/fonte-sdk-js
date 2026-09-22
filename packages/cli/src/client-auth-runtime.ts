import {
  authorizeGrantWithBrowser,
  type BrowserAuthorizationDependencies,
  type MemoryAuthorizationGrant,
} from "./authorization-session.js";
import type {
  ClientAuthBinding,
  ClientAuthDependencies,
  ClientAuthOAuth,
  LoginGrant,
  SessionStatus,
  TokenHandle,
} from "./client-auth-types.js";
import { loadHostedConfig, type HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { withLoginLock } from "./login-lock.js";
import {
  prepareOpenIdAuthorization,
  renewOpenIdAuthorization,
} from "./oauth-client.js";
import { productionDependencies } from "./oauth.js";
import {
  createClientAuthSession,
  type ClientAuthSessionApi,
} from "./persistent-login.js";
import { clientAuthBinding } from "./persistent-login-record.js";
import { createOperatingSystemLoginStore } from "./secure-login-store.js";

export interface ClientAuthRuntimeDependencies {
  readonly fetch: typeof fetch;
  readonly configUrl?: string;
  readonly session?: ClientAuthSessionApi;
  readonly browser?: BrowserAuthorizationDependencies;
  readonly store?: ClientAuthDependencies["store"];
  readonly oauth?: ClientAuthOAuth;
  readonly withLock?: ClientAuthDependencies["withLock"];
  readonly now?: () => number;
  readonly randomUUID?: () => string;
  readonly noninteractiveValue?: () => string | undefined;
}

export interface ClientAuthLoginResult {
  readonly handle: TokenHandle;
  readonly status: SessionStatus;
  readonly serverCheck: "token_issued" | "not_checked";
}

/** The single first-party composition used by CLI commands and the MCP host. */
export class ClientAuthRuntime {
  readonly #fetch: typeof fetch;
  readonly #configUrl?: string;
  readonly #session: ClientAuthSessionApi;
  readonly #noninteractiveValue: () => string | undefined;
  #lastHandle: TokenHandle | undefined;
  #custody: boolean | null = null;

  constructor(dependencies: ClientAuthRuntimeDependencies) {
    this.#fetch = dependencies.fetch;
    this.#configUrl = dependencies.configUrl;
    this.#noninteractiveValue =
      dependencies.noninteractiveValue ??
      (() => process.env.FONTE_NONINTERACTIVE);
    const now = dependencies.now ?? Date.now;
    const browser = dependencies.browser ?? productionDependencies;
    this.#session =
      dependencies.session ??
      createClientAuthSession({
        store: dependencies.store ?? createOperatingSystemLoginStore(),
        oauth: dependencies.oauth ?? createOAuthAdapter(browser, now),
        withLock: dependencies.withLock ?? withLoginLock,
        now,
        randomUUID: dependencies.randomUUID,
      });
  }

  async login(
    switchAccount: boolean,
    signal?: AbortSignal,
  ): Promise<ClientAuthLoginResult> {
    const noninteractive = this.#noninteractive();
    if (noninteractive) throw blocked("authorization_interaction_required");
    const hosted = await this.#loadHosted();
    const binding = clientAuthBinding(hosted);
    const before = await this.#session.status({ signal });
    try {
      const handle = await this.#session.login(binding, {
        switchAccount,
        interactive: true,
        signal,
      });
      const status = await this.#session.status({ signal });
      this.#lastHandle = handle;
      this.#custody = true;
      return {
        handle,
        status,
        serverCheck:
          before.epoch === handle.epoch &&
          before.generation === handle.generation
            ? "not_checked"
            : "token_issued",
      };
    } catch (error) {
      this.#observeFailure(error);
      throw error;
    }
  }

  async status(signal?: AbortSignal): Promise<SessionStatus> {
    this.#noninteractive();
    try {
      const status = await this.#session.status({ signal });
      this.#custody = custodyForStatus(status);
      return status;
    } catch (error) {
      this.#observeFailure(error);
      throw error;
    }
  }

  async logout(signal?: AbortSignal) {
    this.#noninteractive();
    const receipt = await this.#session.logout({ signal });
    this.#lastHandle = undefined;
    this.#custody = receipt.local === "failed" ? null : false;
    return receipt;
  }

  authorize = async (hosted: HostedConfig, signal?: AbortSignal) => {
    this.#noninteractive();
    try {
      const handle = await this.#session.authorize(clientAuthBinding(hosted), {
        signal,
      });
      this.#lastHandle = handle;
      this.#custody = true;
      return handle.accessToken;
    } catch (error) {
      this.#observeFailure(error);
      throw error;
    }
  };

  renewAuthorization = async (
    hosted: HostedConfig,
    signal?: AbortSignal,
    force = false,
  ) => {
    if (!force || !this.#lastHandle) return this.authorize(hosted, signal);
    this.#noninteractive();
    try {
      const handle = await this.#session.refresh(clientAuthBinding(hosted), {
        observedGeneration: this.#lastHandle.generation,
        signal,
      });
      this.#lastHandle = handle;
      this.#custody = true;
      return handle.accessToken;
    } catch (error) {
      this.#observeFailure(error);
      throw error;
    }
  };

  credentialPersisted = (): boolean | null => this.#custody;

  async #loadHosted(): Promise<HostedConfig> {
    return loadHostedConfig(this.#fetch, this.#configUrl);
  }

  #noninteractive(): boolean {
    const value = this.#noninteractiveValue();
    if (value !== undefined && value !== "1")
      throw blocked("hosted_configuration_invalid");
    return value === "1";
  }

  #observeFailure(error: unknown) {
    if (!(error instanceof HostedTestBlockedError)) {
      this.#custody = null;
      return;
    }
    if (error.reason === "login_required" || error.reason === "login_revoked") {
      this.#custody = false;
      return;
    }
    if (
      error.reason === "secure_storage_unavailable" ||
      error.reason === "secure_storage_interaction_required" ||
      error.reason === "login_invalid"
    ) {
      this.#custody = null;
    }
  }
}

export function createClientAuthRuntime(
  dependencies: ClientAuthRuntimeDependencies,
): ClientAuthRuntime {
  return new ClientAuthRuntime(dependencies);
}

function createOAuthAdapter(
  browser: BrowserAuthorizationDependencies,
  now: () => number,
): ClientAuthOAuth {
  return {
    prepareExplicitLogin: async (binding, switchAccount, signal) => ({
      complete: async (commit) => {
        const hosted = bindingToHosted(binding);
        let accepted: LoginGrant | undefined;
        const result = await authorizeGrantWithBrowser(
          hosted,
          { signal },
          {
            ...browser,
            prepare: () =>
              prepareOpenIdAuthorization(hosted, {
                persistent: true,
                switchAccount,
              }),
          },
          now,
          async (candidate) => {
            accepted = checkedLoginGrant(candidate, binding, now());
            await commit(accepted);
            return candidate;
          },
        );
        return accepted ?? checkedLoginGrant(result, binding, now());
      },
    }),
    renew: (binding, refreshToken, expectedSubject, options) =>
      renewOpenIdAuthorization({
        hosted: bindingToHosted(binding),
        refreshToken,
        expectedSubject,
        signal: options.signal,
        beforeExchange: options.beforeExchange,
      }),
  };
}

function checkedLoginGrant(
  candidate: MemoryAuthorizationGrant,
  binding: ClientAuthBinding,
  receivedAt: number,
): LoginGrant {
  if (
    !candidate.accessToken.trim() ||
    !candidate.refreshToken?.trim() ||
    !candidate.subject?.trim() ||
    candidate.expiresAt === null ||
    !Number.isFinite(candidate.expiresAt) ||
    candidate.expiresAt <= receivedAt ||
    !sameScopes(candidate.scopes, binding.scopes)
  )
    throw blocked("authorization_failed");
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    subject: candidate.subject,
    scopes: [...candidate.scopes!],
    expiresAt: candidate.expiresAt,
  };
}

function sameScopes(
  actual: readonly string[] | undefined,
  expected: readonly string[],
) {
  if (!actual || actual.length !== expected.length) return false;
  const sorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return sorted.every((scope, index) => scope === expectedSorted[index]);
}

function bindingToHosted(binding: ClientAuthBinding): HostedConfig {
  if (
    binding.redirectUri !== "http://127.0.0.1:49671/callback" ||
    binding.scopes.length !== 1 ||
    binding.scopes[0] !== "email"
  )
    throw blocked("authorization_failed");
  return {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: binding.issuer,
    clientId: binding.clientId,
    coreApiBaseUrl: binding.coreApiTarget,
    redirectUri: binding.redirectUri,
    scopes: ["email"],
  };
}

function custodyForStatus(status: SessionStatus): boolean | null {
  if (status.state === "ready") return true;
  if (
    status.state === "absent" ||
    status.state === "signed_out" ||
    status.state === "login_pending" ||
    status.state === "login_pending_expired" ||
    status.state === "revoked"
  )
    return false;
  return null;
}

function blocked(reason: string): HostedTestBlockedError {
  return new HostedTestBlockedError(reason);
}
