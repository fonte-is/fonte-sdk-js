import {
  assertAuthorizationActive,
  authorizeGrantWithBrowser,
  type BrowserAuthorizationTokenResponse,
} from "./authorization-session.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  blocked,
  candidateLogin,
  loginAuthority,
  parseLogin,
  validateLoginGrant,
  type PersistentLoginDependencies,
  type StoredLogin,
} from "./persistent-login-record.js";

export { loginAuthority } from "./persistent-login-record.js";
export type { PersistentLoginDependencies } from "./persistent-login-record.js";

/** Identity continuity only. Every command still obtains its authority from Core. */
export function createPersistentLoginSession(
  deps: PersistentLoginDependencies,
) {
  return new LoginSession(deps);
}

export type PersistentLoginSession = ReturnType<
  typeof createPersistentLoginSession
>;

class LoginSession {
  #deps: PersistentLoginDependencies;
  #now: () => number;
  #authority: string | undefined;
  #identity: { loginId: string; subject: string } | undefined;
  #memory: { accessToken: string; expiresAt: number } | undefined;
  #persisted = false;

  constructor(deps: PersistentLoginDependencies) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  authorize = (hosted: HostedConfig, signal?: AbortSignal) =>
    this.#acquire(hosted, signal);

  refresh = (hosted: HostedConfig, signal?: AbortSignal) =>
    this.#acquire(hosted, signal, true, false);

  login = (hosted: HostedConfig, switchAccount = false, signal?: AbortSignal) =>
    this.#deps.withLock(async () => {
      assertAuthorizationActive(signal);
      this.#authority = loginAuthority(hosted);
      this.#identity = undefined;
      this.#memory = undefined;
      if (!switchAccount && (await this.#resumeLogin(hosted, signal))) return;
      await this.#forget();
      this.#identity = undefined;
      await this.#browserLogin(hosted, switchAccount, signal);
    }, signal);

  status = async (
    hosted: HostedConfig,
    signal?: AbortSignal,
  ): Promise<"signed_in" | "signed_out"> => {
    try {
      await this.#acquire(hosted, signal, false, false);
      return "signed_in";
    } catch (error) {
      if (
        error instanceof HostedTestBlockedError &&
        error.reason === "login_required"
      )
        return "signed_out";
      throw error;
    }
  };

  logout = (signal?: AbortSignal) =>
    this.#deps.withLock(async () => {
      assertAuthorizationActive(signal);
      await this.#forget();
    }, signal);

  credentialPersisted = () => this.#persisted;

  async #resumeLogin(hosted: HostedConfig, signal?: AbortSignal) {
    try {
      const stored = await this.#read();
      if (stored && stored.authority === this.#authority) {
        await this.#refreshStored(hosted, stored);
        assertAuthorizationActive(signal);
        return true;
      }
    } catch (error) {
      if (
        !(error instanceof HostedTestBlockedError) ||
        !["login_invalid", "login_changed", "login_refresh_failed"].includes(
          error.reason,
        )
      )
        throw error;
    }
    return false;
  }

  #bind(hosted: HostedConfig) {
    const next = loginAuthority(hosted);
    if (this.#authority !== undefined && this.#authority !== next)
      throw blocked("login_changed");
    this.#authority = next;
    return next;
  }

  async #read(): Promise<StoredLogin | null> {
    const value = await this.#deps.store.read();
    return value === null ? null : parseLogin(value);
  }

  async #forget() {
    this.#memory = undefined;
    this.#persisted = false;
    await this.#deps.store.remove();
  }

  #adopt(stored: StoredLogin) {
    if (
      stored.authority !== this.#authority ||
      (this.#identity &&
        (stored.loginId !== this.#identity.loginId ||
          stored.subject !== this.#identity.subject))
    ) {
      throw blocked("login_changed");
    }
    this.#identity = { loginId: stored.loginId, subject: stored.subject };
  }

  async #commit(stored: StoredLogin, grant: BrowserAuthorizationTokenResponse) {
    validateLoginGrant(stored, grant);
    const expiresAt = this.#now() + grant.expiresInSeconds! * 1_000;
    const next = { ...stored, refreshToken: grant.refreshToken };
    await this.#deps.store.write(JSON.stringify(next));
    if (expiresAt <= this.#now()) throw blocked("login_invalid");
    this.#persisted = true;
    this.#identity = { loginId: stored.loginId, subject: stored.subject };
    this.#memory = {
      accessToken: grant.accessToken,
      expiresAt,
    };
    return grant.accessToken;
  }

  async #refreshStored(hosted: HostedConfig, stored: StoredLogin) {
    this.#adopt(stored);
    try {
      // A crash after token rotation must not leave the old token reusable.
      // This non-secret marker also survives an unavailable cleanup operation.
      this.#memory = undefined;
      this.#persisted = false;
      await this.#deps.store.write(
        JSON.stringify({ version: 1, state: "refreshing" }),
      );
      const next = await this.#deps.refreshGrant(
        hosted,
        stored.refreshToken,
        stored.subject,
      );
      return await this.#commit(stored, {
        ...next,
        refreshToken: next.refreshToken ?? stored.refreshToken,
      });
    } catch (error) {
      // A lost rotation response cannot make the previous token safe to reuse.
      await this.#forget();
      if (
        error instanceof HostedTestBlockedError &&
        error.reason === "secure_storage_unavailable"
      )
        throw error;
      throw blocked("login_refresh_failed");
    }
  }

  async #browserLogin(
    hosted: HostedConfig,
    switchAccount: boolean,
    signal?: AbortSignal,
  ) {
    try {
      const grant = await authorizeGrantWithBrowser(
        hosted,
        { signal },
        {
          ...this.#deps.browser,
          prepare: (config) => this.#deps.prepareLogin(config, switchAccount),
        },
        this.#now,
        async (candidate) => {
          const { stored, grant } = candidateLogin(
            candidate,
            () => this.#bind(hosted),
            this.#now,
          );
          await this.#commit(stored, grant);
          return candidate;
        },
      );
      assertAuthorizationActive(signal);
      return grant.accessToken;
    } catch (error) {
      // This lock still owns the new login; cancellation cannot retain it.
      await this.#forget();
      throw error;
    }
  }

  #acquire(
    hosted: HostedConfig,
    signal?: AbortSignal,
    force = false,
    interactive = true,
  ) {
    return this.#deps.withLock(async () => {
      assertAuthorizationActive(signal);
      this.#bind(hosted);
      const stored = await this.#read();
      if (!stored) {
        this.#memory = undefined;
        this.#persisted = false;
        if (this.#identity || !interactive) throw blocked("login_required");
        return this.#browserLogin(hosted, false, signal);
      }
      this.#adopt(stored);
      let token: string;
      if (
        !force &&
        this.#memory &&
        this.#memory.expiresAt > this.#now() + 30_000
      )
        token = this.#memory.accessToken;
      else token = await this.#refreshStored(hosted, stored);
      assertAuthorizationActive(signal);
      return token;
    }, signal);
  }
}
