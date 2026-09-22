import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  assertAuthorizationActive,
  authorizeGrantWithBrowser,
  type MemoryAuthorizationGrant,
} from "./authorization-session.js";
import {
  CLIENT_SESSION_SCHEMA,
  type AuthorizationOptions,
  type ClientAuthBinding,
  type ClientAuthDependencies,
  type ClientSessionRecord,
  type LoginGrant,
  type LoginOptions,
  type LogoutReceipt,
  type ReadyRecord,
  type RefreshPendingRecord,
  type RefreshOptions,
  type RenewOutcome,
  type SessionStatus,
  type TokenHandle,
} from "./client-auth-types.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  blocked,
  clientAuthBinding,
  nextGeneration,
  parseSessionRecord,
  sameBinding,
  type PersistentLoginDependencies,
} from "./persistent-login-record.js";

export { loginAuthority } from "./persistent-login-record.js";
export type {
  ClientAuthBinding,
  ClientAuthDependencies,
  ClientAuthOAuth,
  ClientAuthStore,
  ClientSessionRecord,
  LoginGrant,
  LogoutReceipt,
  RenewOutcome,
  SessionStatus,
  TokenHandle,
} from "./client-auth-types.js";
export type { PersistentLoginDependencies } from "./persistent-login-record.js";

const REFRESH_LEAD_MS = 30_000;
const LOGIN_PENDING_MS = 300_000;

/** Identity continuity only. Core still authorizes every product operation. */
export function createClientAuthSession(deps: ClientAuthDependencies) {
  return new ClientAuthSession(deps);
}

export type ClientAuthSessionApi = ReturnType<typeof createClientAuthSession>;

class ClientAuthSession {
  readonly #deps: ClientAuthDependencies;
  readonly #now: () => number;
  readonly #uuid: () => string;
  #identity:
    { epoch: string; loginId: string; binding: ClientAuthBinding } | undefined;
  #memory: TokenHandle | undefined;

  constructor(deps: ClientAuthDependencies) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#uuid = deps.randomUUID ?? randomUUID;
  }

  async login(
    binding: ClientAuthBinding,
    options: LoginOptions,
  ): Promise<TokenHandle> {
    if (!options.interactive)
      throw blocked("authorization_interaction_required");
    const pending = await this.#deps.withLock(async () => {
      active(options.signal);
      const current = await this.#read(options.signal);
      if (
        !options.switchAccount &&
        current?.state === "ready" &&
        sameBinding(current.binding, binding)
      ) {
        return { kind: "reuse" as const };
      }
      if (
        current?.state === "login_pending" &&
        current.expiresAt > this.#now()
      ) {
        throw blocked("login_busy");
      }
      const createdAt = this.#now();
      if (!safeTimestamp(createdAt)) throw blocked("login_invalid");
      const record: ClientSessionRecord = {
        schema: CLIENT_SESSION_SCHEMA,
        state: "login_pending",
        binding: copyBinding(binding),
        loginId: this.#uuid(),
        epoch: this.#uuid(),
        generation: nextGeneration(current),
        createdAt,
        expiresAt: createdAt + LOGIN_PENDING_MS,
      };
      await this.#replace(record, true, options.signal);
      return { kind: "pending" as const, record };
    }, options.signal);

    if (pending.kind === "reuse") {
      return this.authorize(binding, { signal: options.signal });
    }

    let committed: TokenHandle | undefined;
    try {
      const prepared = await this.#deps.oauth.prepareExplicitLogin(
        copyBinding(binding),
        options.switchAccount,
        options.signal,
      );
      await prepared.complete(async (grant) => {
        committed = await this.#deps.withLock(
          () => this.#commitLogin(pending.record, grant, options.signal),
          options.signal,
        );
      });
      active(options.signal);
      if (!committed) throw blocked("authorization_failed");
      return committed;
    } catch (error) {
      await this.#cleanOwnPending(pending.record);
      if (options.signal?.aborted) throw blocked("authorization_cancelled");
      throw sanitized(error, "authorization_failed");
    }
  }

  authorize(
    binding: ClientAuthBinding,
    options: AuthorizationOptions = {},
  ): Promise<TokenHandle> {
    return this.#deps.withLock(
      () => this.#acquire(binding, options.signal),
      options.signal,
    );
  }

  refresh(
    binding: ClientAuthBinding,
    options: RefreshOptions,
  ): Promise<TokenHandle> {
    if (
      !Number.isSafeInteger(options.observedGeneration) ||
      options.observedGeneration < 0
    )
      return Promise.reject(blocked("login_invalid"));
    return this.#deps.withLock(
      () => this.#acquire(binding, options.signal, options.observedGeneration),
      options.signal,
    );
  }

  status(options: AuthorizationOptions = {}): Promise<SessionStatus> {
    return this.#deps.withLock(async () => {
      active(options.signal);
      const record = await this.#read(options.signal);
      if (record === null)
        return { state: "absent", serverCheck: "not_checked" };
      const base = {
        state:
          record.state === "login_pending" && record.expiresAt <= this.#now()
            ? ("login_pending_expired" as const)
            : record.state,
        epoch: record.epoch,
        generation: record.generation,
        serverCheck: "not_checked" as const,
      };
      if (record.state === "signed_out") return base;
      if (record.state === "login_pending")
        return {
          ...base,
          binding: copyBinding(record.binding),
          loginId: record.loginId,
        };
      return {
        ...base,
        binding: copyBinding(record.binding),
        loginId: record.loginId,
        subject: record.subject,
      };
    }, options.signal);
  }

  async logout(options: AuthorizationOptions = {}): Promise<LogoutReceipt> {
    try {
      return await this.#deps.withLock(async () => {
        active(options.signal);
        const current = await this.#read(options.signal);
        const already = current === null || current.state === "signed_out";
        const signedOut: ClientSessionRecord = {
          schema: CLIENT_SESSION_SCHEMA,
          state: "signed_out",
          epoch: this.#uuid(),
          generation: nextGeneration(current),
        };
        await this.#replace(signedOut, true, options.signal);
        this.#memory = undefined;
        this.#identity = undefined;
        return {
          local: already ? "already_signed_out" : "cleared",
          remote: "unsupported",
        };
      }, options.signal);
    } catch {
      return { local: "failed", remote: "unsupported" };
    }
  }

  async #acquire(
    binding: ClientAuthBinding,
    signal?: AbortSignal,
    observedGeneration?: number,
  ): Promise<TokenHandle> {
    active(signal);
    let record = await this.#read(signal);
    if (record === null || record.state === "signed_out") {
      this.#memory = undefined;
      throw blocked("login_required");
    }
    if (record.state === "login_pending") {
      this.#memory = undefined;
      throw blocked(
        record.expiresAt > this.#now() ? "login_busy" : "login_required",
      );
    }
    if (!sameBinding(record.binding, binding)) throw blocked("login_changed");
    this.#assertIdentity(record);
    if (record.state === "refresh_pending") {
      const uncertain: ClientSessionRecord = {
        ...record,
        state: "refresh_uncertain",
        generation: nextGeneration(record),
      };
      await this.#replace(uncertain, false, signal);
      this.#memory = undefined;
      throw blocked("login_refresh_uncertain");
    }
    if (record.state === "refresh_uncertain") {
      this.#memory = undefined;
      throw blocked("login_refresh_uncertain");
    }
    if (record.state === "revoked") {
      this.#memory = undefined;
      throw blocked("login_revoked");
    }

    const cached = this.#suitableMemory(record);
    const forceSatisfied =
      observedGeneration !== undefined &&
      record.generation > observedGeneration &&
      cached !== undefined;
    if (cached && (observedGeneration === undefined || forceSatisfied)) {
      active(signal);
      return cached;
    }
    return this.#renew(record, signal);
  }

  async #renew(ready: ReadyRecord, signal?: AbortSignal): Promise<TokenHandle> {
    let pending: RefreshPendingRecord | undefined;
    let markerError: unknown;
    let markerCalls = 0;
    let outcome: RenewOutcome;
    try {
      outcome = await this.#deps.oauth.renew(
        copyBinding(ready.binding),
        ready.refreshToken,
        ready.subject,
        {
          signal,
          beforeExchange: async () => {
            markerCalls += 1;
            if (markerCalls !== 1) throw blocked("login_invalid");
            try {
              active(signal);
              pending = {
                ...ready,
                state: "refresh_pending",
                generation: nextGeneration(ready),
              };
              await this.#replace(pending, false, signal);
            } catch (error) {
              markerError = error;
              throw error;
            }
          },
        },
      );
    } catch (error) {
      if (markerError)
        throw sanitized(markerError, "secure_storage_unavailable");
      if (pending) {
        await this.#markUncertain(pending, signal);
        throw blocked("login_refresh_uncertain");
      }
      throw sanitized(error, "login_refresh_unavailable");
    }

    if (markerError) throw sanitized(markerError, "secure_storage_unavailable");
    if (outcome.tag === "retryable_before_exchange") {
      if (outcome.exchangeSubmitted)
        return this.#unexpectedSubmitted(pending ?? ready, signal);
      if (pending) await this.#restoreReady(pending, signal);
      throw blocked("login_refresh_unavailable");
    }
    if (outcome.tag === "rejected_configuration") {
      if (outcome.exchangeSubmitted)
        return this.#unexpectedSubmitted(pending ?? ready, signal);
      if (pending) await this.#restoreReady(pending, signal);
      throw blocked("authorization_failed");
    }
    if (outcome.tag === "cancelled_before_exchange") {
      if (outcome.exchangeSubmitted)
        return this.#unexpectedSubmitted(pending ?? ready, signal);
      if (pending) await this.#restoreReady(pending, signal);
      throw blocked("authorization_cancelled");
    }
    if (!pending) return this.#unexpectedSubmitted(ready, signal);
    if (markerCalls !== 1 || !outcome.exchangeSubmitted)
      throw blocked("login_invalid");
    if (outcome.tag === "rejected_invalid_grant") {
      const revoked: ClientSessionRecord = {
        schema: CLIENT_SESSION_SCHEMA,
        state: "revoked",
        binding: copyBinding(ready.binding),
        loginId: ready.loginId,
        subject: ready.subject,
        epoch: ready.epoch,
        generation: nextGeneration(pending),
      };
      await this.#replace(revoked, false, signal);
      this.#memory = undefined;
      throw blocked("login_revoked");
    }
    if (outcome.tag === "exchange_uncertain") {
      await this.#markUncertain(pending, signal);
      throw blocked("login_refresh_uncertain");
    }
    if (outcome.tag === "identity_mismatch") {
      await this.#markUncertain(pending, signal);
      throw blocked("login_changed");
    }

    let grant: LoginGrant;
    try {
      grant = checkedGrant(outcome, ready.binding, ready.subject, this.#now());
    } catch {
      await this.#markUncertain(pending, signal);
      throw blocked("login_refresh_uncertain");
    }
    const successor: ReadyRecord = {
      schema: CLIENT_SESSION_SCHEMA,
      state: "ready",
      binding: copyBinding(ready.binding),
      loginId: ready.loginId,
      subject: ready.subject,
      refreshToken: grant.refreshToken,
      epoch: ready.epoch,
      generation: nextGeneration(pending),
    };
    await this.#replace(successor, false, signal);
    const handle = tokenHandle(successor, grant);
    if (handle.expiresAt <= this.#now()) {
      this.#memory = undefined;
      throw blocked("login_refresh_unavailable");
    }
    this.#remember(successor, handle);
    active(signal);
    return handle;
  }

  async #commitLogin(
    pending: Extract<ClientSessionRecord, { state: "login_pending" }>,
    candidate: LoginGrant,
    signal?: AbortSignal,
  ): Promise<TokenHandle> {
    active(signal);
    const current = await this.#read(signal);
    if (
      current?.state !== "login_pending" ||
      current.epoch !== pending.epoch ||
      current.loginId !== pending.loginId ||
      !sameBinding(current.binding, pending.binding)
    )
      throw blocked("login_changed");
    if (current.expiresAt <= this.#now()) throw blocked("authorization_failed");
    const grant = checkedGrant(
      candidate,
      pending.binding,
      undefined,
      this.#now(),
    );
    const ready: ReadyRecord = {
      schema: CLIENT_SESSION_SCHEMA,
      state: "ready",
      binding: copyBinding(pending.binding),
      loginId: pending.loginId,
      subject: grant.subject,
      refreshToken: grant.refreshToken,
      epoch: pending.epoch,
      generation: nextGeneration(current),
    };
    await this.#replace(ready, true, signal);
    const handle = tokenHandle(ready, grant);
    if (handle.expiresAt <= this.#now()) throw blocked("authorization_failed");
    this.#remember(ready, handle);
    active(signal);
    return handle;
  }

  async #cleanOwnPending(
    pending: Extract<ClientSessionRecord, { state: "login_pending" }>,
    signal?: AbortSignal,
  ) {
    try {
      await this.#deps.withLock(async () => {
        const current = await this.#read(signal);
        if (
          current?.state !== "login_pending" ||
          current.epoch !== pending.epoch ||
          current.loginId !== pending.loginId
        )
          return;
        const signedOut: ClientSessionRecord = {
          schema: CLIENT_SESSION_SCHEMA,
          state: "signed_out",
          epoch: this.#uuid(),
          generation: nextGeneration(current),
        };
        await this.#replace(signedOut, true, signal);
      }, signal);
    } catch {
      // Preserve the original sanitized login failure. A failed cleanup is
      // still fenced by matching the pending epoch on every completion.
    }
  }

  async #markUncertain(record: ClientSessionRecord, signal?: AbortSignal) {
    if (record.state !== "refresh_pending" && record.state !== "ready")
      throw blocked("login_invalid");
    const uncertain: ClientSessionRecord = {
      ...record,
      state: "refresh_uncertain",
      generation: nextGeneration(record),
    };
    await this.#replace(uncertain, false, signal);
    this.#memory = undefined;
  }

  async #restoreReady(
    pending: Extract<ClientSessionRecord, { state: "refresh_pending" }>,
    signal?: AbortSignal,
  ) {
    const ready: ReadyRecord = {
      ...pending,
      state: "ready",
      generation: nextGeneration(pending),
    };
    await this.#replace(ready, false, signal);
    this.#memory = undefined;
  }

  async #unexpectedSubmitted(
    record: ClientSessionRecord,
    signal?: AbortSignal,
  ): Promise<never> {
    await this.#markUncertain(record, signal);
    throw blocked("login_refresh_uncertain");
  }

  #suitableMemory(record: ReadyRecord): TokenHandle | undefined {
    const memory = this.#memory;
    if (
      memory &&
      memory.epoch === record.epoch &&
      memory.loginId === record.loginId &&
      memory.generation === record.generation &&
      memory.expiresAt > this.#now() + REFRESH_LEAD_MS
    )
      return memory;
    return undefined;
  }

  #assertIdentity(
    record: Exclude<
      ClientSessionRecord,
      { state: "signed_out" | "login_pending" }
    >,
  ) {
    if (
      this.#identity &&
      (this.#identity.epoch !== record.epoch ||
        this.#identity.loginId !== record.loginId ||
        !sameBinding(this.#identity.binding, record.binding))
    )
      throw blocked("login_changed");
  }

  #remember(record: ReadyRecord, handle: TokenHandle) {
    this.#identity = {
      epoch: record.epoch,
      loginId: record.loginId,
      binding: copyBinding(record.binding),
    };
    this.#memory = handle;
  }

  async #read(signal?: AbortSignal): Promise<ClientSessionRecord | null> {
    try {
      const value = await this.#deps.store.read({
        allowInteraction: false,
        signal,
      });
      return value === null ? null : parseSessionRecord(value);
    } catch (error) {
      throw sanitized(error, "secure_storage_unavailable");
    }
  }

  async #replace(
    record: ClientSessionRecord,
    allowInteraction: boolean,
    signal?: AbortSignal,
  ) {
    parseSessionRecord(record);
    try {
      await this.#deps.store.replace(record, { allowInteraction, signal });
      const readback = await this.#deps.store.read({
        allowInteraction: false,
        signal,
      });
      if (readback === null || !isDeepStrictEqual(readback, record))
        throw blocked("secure_storage_unavailable");
    } catch (error) {
      throw sanitized(error, "secure_storage_unavailable");
    }
  }
}

/**
 * Compatibility surface for the existing CLI composition. It translates the
 * old arguments and string store but never introduces implicit login.
 */
export function createPersistentLoginSession(
  deps: PersistentLoginDependencies,
) {
  const now = deps.now ?? Date.now;
  const engine = createClientAuthSession({
    now,
    randomUUID: deps.randomUUID,
    withLock: deps.withLock,
    store: {
      read: async () => {
        const value = await deps.store.read();
        return value === null ? null : parseSessionRecord(value);
      },
      replace: async (record) => {
        const value = JSON.stringify(record);
        await deps.store.write(value);
        if ((await deps.store.read()) !== value)
          throw blocked("secure_storage_unavailable");
      },
    },
    oauth: {
      prepareExplicitLogin: async (binding, switchAccount, signal) => ({
        complete: async (commit) => {
          const hosted = bindingToHosted(binding);
          let accepted: LoginGrant | undefined;
          const result = await authorizeGrantWithBrowser(
            hosted,
            { signal },
            {
              ...deps.browser,
              prepare: () => deps.prepareLogin(hosted, switchAccount),
            },
            now,
            async (candidate) => {
              accepted = legacyGrant(candidate, binding, now());
              await commit(accepted);
              return candidate;
            },
          );
          return accepted ?? legacyGrant(result, binding, now());
        },
      }),
      renew: async (binding, refreshToken, subject, options) => {
        let markerCommitted = false;
        let exchangeInvoked = false;
        try {
          active(options.signal);
          await options.beforeExchange();
          markerCommitted = true;
          active(options.signal);
          exchangeInvoked = true;
          const response = await deps.refreshGrant(
            bindingToHosted(binding),
            refreshToken,
            subject,
          );
          const expiresAt = now() + Number(response.expiresInSeconds) * 1_000;
          if (
            response.subject !== subject ||
            !sameScopes(response.scopes, binding.scopes)
          )
            return {
              tag: "identity_mismatch" as const,
              reason:
                response.subject !== subject
                  ? ("subject_mismatch" as const)
                  : ("scope_mismatch" as const),
              exchangeSubmitted: true as const,
            };
          if (
            !response.accessToken?.trim() ||
            !response.refreshToken?.trim() ||
            !Number.isFinite(expiresAt)
          )
            return {
              tag: "exchange_uncertain" as const,
              reason: "response_invalid" as const,
              exchangeSubmitted: true as const,
            };
          return {
            tag: "success" as const,
            exchangeSubmitted: true as const,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt,
            subject,
            scopes: [...binding.scopes],
          };
        } catch {
          if (options.signal?.aborted && !exchangeInvoked)
            return {
              tag: "cancelled_before_exchange" as const,
              reason: "cancelled" as const,
              exchangeSubmitted: false as const,
            };
          if (!markerCommitted) throw blocked("secure_storage_unavailable");
          return {
            tag: "exchange_uncertain" as const,
            reason: "exchange_uncertain" as const,
            exchangeSubmitted: true as const,
          };
        }
      },
    },
  });
  return new PersistentLoginCompatibility(engine);
}

export type PersistentLoginSession = ReturnType<
  typeof createPersistentLoginSession
>;

class PersistentLoginCompatibility {
  #last: TokenHandle | undefined;
  #persisted = false;

  constructor(private readonly session: ClientAuthSessionApi) {}

  authorize = async (hosted: HostedConfig, signal?: AbortSignal) => {
    this.#last = await this.session.authorize(clientAuthBinding(hosted), {
      signal,
    });
    this.#persisted = true;
    return this.#last.accessToken;
  };

  refresh = async (hosted: HostedConfig, signal?: AbortSignal) => {
    this.#last = await this.session.refresh(clientAuthBinding(hosted), {
      observedGeneration: this.#last?.generation ?? 0,
      signal,
    });
    this.#persisted = true;
    return this.#last.accessToken;
  };

  login = async (
    hosted: HostedConfig,
    switchAccount = false,
    signal?: AbortSignal,
  ) => {
    this.#last = await this.session.login(clientAuthBinding(hosted), {
      switchAccount,
      interactive: true,
      signal,
    });
    this.#persisted = true;
  };

  status = async (
    hosted: HostedConfig,
    signal?: AbortSignal,
  ): Promise<"signed_in" | "signed_out"> => {
    const status = await this.session.status({ signal });
    if (
      status.binding &&
      !sameBinding(status.binding, clientAuthBinding(hosted))
    )
      throw blocked("login_changed");
    if (status.state === "ready") {
      this.#persisted = true;
      return "signed_in";
    }
    if (status.state === "absent" || status.state === "signed_out") {
      this.#persisted = false;
      return "signed_out";
    }
    if (status.state === "login_pending") throw blocked("login_busy");
    if (status.state === "login_pending_expired")
      throw blocked("login_required");
    if (status.state === "revoked") throw blocked("login_revoked");
    if (
      status.state === "refresh_pending" ||
      status.state === "refresh_uncertain"
    )
      throw blocked("login_refresh_uncertain");
    throw blocked("login_invalid");
  };

  logout = async (signal?: AbortSignal) => {
    const result = await this.session.logout({ signal });
    if (result.local === "failed") throw blocked("secure_storage_unavailable");
    this.#last = undefined;
    this.#persisted = false;
  };

  credentialPersisted = () => this.#persisted;
}

function checkedGrant(
  grant: LoginGrant,
  binding: ClientAuthBinding,
  subject: string | undefined,
  receivedAt: number,
): LoginGrant {
  if (
    !grant.accessToken?.trim() ||
    !grant.refreshToken?.trim() ||
    !grant.subject?.trim() ||
    (subject !== undefined && grant.subject !== subject) ||
    !sameScopes(grant.scopes, binding.scopes) ||
    !Number.isFinite(grant.expiresAt) ||
    grant.expiresAt <= receivedAt
  )
    throw blocked(subject === undefined ? "login_invalid" : "login_changed");
  return {
    ...grant,
    scopes: [...grant.scopes],
  };
}

function legacyGrant(
  candidate: MemoryAuthorizationGrant,
  binding: ClientAuthBinding,
  receivedAt: number,
): LoginGrant {
  return checkedGrant(
    {
      accessToken: candidate.accessToken,
      refreshToken: candidate.refreshToken ?? "",
      expiresAt: candidate.expiresAt ?? Number.NaN,
      subject: candidate.subject ?? "",
      scopes: candidate.scopes ?? [],
    },
    binding,
    undefined,
    receivedAt,
  );
}

function tokenHandle(record: ReadyRecord, grant: LoginGrant): TokenHandle {
  return {
    accessToken: grant.accessToken,
    loginId: record.loginId,
    epoch: record.epoch,
    generation: record.generation,
    expiresAt: grant.expiresAt,
  };
}

function copyBinding(binding: ClientAuthBinding): ClientAuthBinding {
  return { ...binding, scopes: [...binding.scopes].sort() };
}

function sameScopes(
  actual: readonly string[] | undefined,
  expected: readonly string[],
) {
  if (!actual || actual.length !== expected.length) return false;
  const sorted = [...actual].sort();
  return sorted.every((scope, index) => scope === expected[index]);
}

function bindingToHosted(binding: ClientAuthBinding): HostedConfig {
  return {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: binding.issuer,
    clientId: binding.clientId,
    coreApiBaseUrl: binding.coreApiTarget,
    redirectUri: binding.redirectUri as HostedConfig["redirectUri"],
    scopes: [...binding.scopes] as unknown as HostedConfig["scopes"],
  };
}

function active(signal?: AbortSignal) {
  assertAuthorizationActive(signal);
}

function safeTimestamp(value: number) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value + LOGIN_PENDING_MS)
  );
}

function sanitized(error: unknown, fallback: string): HostedTestBlockedError {
  if (
    error instanceof HostedTestBlockedError &&
    [
      "authorization_cancelled",
      "authorization_failed",
      "authorization_interaction_required",
      "login_busy",
      "login_changed",
      "login_invalid",
      "login_refresh_uncertain",
      "secure_storage_interaction_required",
      "secure_storage_unavailable",
    ].includes(error.reason)
  )
    return blocked(error.reason);
  return blocked(fallback);
}
