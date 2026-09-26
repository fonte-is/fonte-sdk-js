export const CLIENT_SESSION_SCHEMA = "fonte.client_session.v1" as const;

export interface ClientAuthBinding {
  readonly issuer: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly coreApiTarget: string;
  readonly redirectUri: string;
}

interface RecordBase {
  readonly schema: typeof CLIENT_SESSION_SCHEMA;
  readonly epoch: string;
  readonly generation: number;
}

export interface SignedOutRecord extends RecordBase {
  readonly state: "signed_out";
}

export interface LoginPendingRecord extends RecordBase {
  readonly state: "login_pending";
  readonly binding: ClientAuthBinding;
  readonly loginId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface CredentialRecord extends RecordBase {
  readonly binding: ClientAuthBinding;
  readonly loginId: string;
  readonly subject: string;
}

export interface ReadyRecord extends CredentialRecord {
  readonly state: "ready";
  readonly refreshToken: string;
}

export interface RefreshPendingRecord extends CredentialRecord {
  readonly state: "refresh_pending";
  readonly refreshToken: string;
}

export interface RefreshUncertainRecord extends CredentialRecord {
  readonly state: "refresh_uncertain";
  readonly refreshToken: string;
}

export interface RevokedRecord extends CredentialRecord {
  readonly state: "revoked";
  readonly refreshToken?: string;
}

export type ClientSessionRecord =
  | SignedOutRecord
  | LoginPendingRecord
  | ReadyRecord
  | RefreshPendingRecord
  | RefreshUncertainRecord
  | RevokedRecord;

export interface ClientAuthStore {
  read(options: {
    readonly allowInteraction: false;
    readonly signal?: AbortSignal;
  }): Promise<ClientSessionRecord | null>;
  replace(
    record: ClientSessionRecord,
    options: {
      readonly allowInteraction: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;
  /** Optional final removal for stores whose logout contract deletes a file. */
  clearSession?(): Promise<void>;
}

export interface LoginGrant {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly subject: string;
  readonly scopes: readonly string[];
}

export interface PreparedExplicitLogin {
  complete(commit: (grant: LoginGrant) => Promise<void>): Promise<LoginGrant>;
}

export type RenewFailureReason =
  | "provider_unavailable"
  | "configuration_rejected"
  | "invalid_grant"
  | "exchange_uncertain"
  | "subject_mismatch"
  | "scope_mismatch"
  | "response_invalid"
  | "cancelled";

export type RenewOutcome =
  | ({ readonly tag: "success"; readonly exchangeSubmitted: true } & LoginGrant)
  | {
      readonly tag: "retryable_before_exchange";
      readonly reason: "provider_unavailable";
      readonly exchangeSubmitted: false;
    }
  | {
      readonly tag: "rejected_configuration";
      readonly reason: "configuration_rejected";
      readonly exchangeSubmitted: false;
    }
  | {
      readonly tag: "rejected_invalid_grant";
      readonly reason: "invalid_grant";
      readonly exchangeSubmitted: true;
    }
  | {
      readonly tag: "exchange_uncertain";
      readonly reason: "exchange_uncertain" | "response_invalid";
      readonly exchangeSubmitted: true;
    }
  | {
      readonly tag: "identity_mismatch";
      readonly reason: "subject_mismatch" | "scope_mismatch";
      readonly exchangeSubmitted: true;
    }
  | {
      readonly tag: "cancelled_before_exchange";
      readonly reason: "cancelled";
      readonly exchangeSubmitted: false;
    };

export interface ClientAuthOAuth {
  prepareExplicitLogin(
    binding: ClientAuthBinding,
    switchAccount: boolean,
    signal?: AbortSignal,
  ): Promise<PreparedExplicitLogin>;
  renew(
    binding: ClientAuthBinding,
    refreshToken: string,
    expectedSubject: string,
    options: {
      readonly beforeExchange: () => Promise<void>;
      readonly signal?: AbortSignal;
    },
  ): Promise<RenewOutcome>;
}

export interface TokenHandle {
  readonly accessToken: string;
  readonly loginId: string;
  readonly epoch: string;
  readonly generation: number;
  readonly expiresAt: number;
}

export interface ClientAuthDependencies {
  readonly store: ClientAuthStore;
  readonly oauth: ClientAuthOAuth;
  readonly withLock: <T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}

export interface LoginOptions {
  readonly switchAccount: boolean;
  readonly interactive: boolean;
  readonly signal?: AbortSignal;
}

export interface AuthorizationOptions {
  readonly signal?: AbortSignal;
}

export interface RefreshOptions extends AuthorizationOptions {
  readonly observedGeneration: number;
}

export interface SessionStatus {
  readonly state:
    ClientSessionRecord["state"] | "absent" | "login_pending_expired";
  readonly binding?: ClientAuthBinding;
  readonly loginId?: string;
  readonly subject?: string;
  readonly epoch?: string;
  readonly generation?: number;
  readonly serverCheck: "not_checked";
}

export interface LogoutReceipt {
  readonly local: "cleared" | "already_signed_out" | "failed";
  readonly remote: "revoked" | "unsupported" | "unavailable";
}
