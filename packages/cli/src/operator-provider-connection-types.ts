import type { ProviderAudienceProvider } from "./operator-provider-audience-types.js";

export type ProviderConnectionProvider = ProviderAudienceProvider;

interface ProviderConnectionCommandBase {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly provider: ProviderConnectionProvider;
}

export type ProviderConnectionOperatorCommand =
  | (ProviderConnectionCommandBase & {
      readonly kind: "bridge_connection_list";
    })
  | (ProviderConnectionCommandBase & {
      readonly kind: "bridge_connection_connect";
      readonly displayName: string;
    })
  | (ProviderConnectionCommandBase & {
      readonly kind: "bridge_connection_reconnect";
      readonly connectionId: string;
      readonly displayName: string;
      readonly expectedCredentialVersion: number;
    });

export interface ProviderConnectionMetadataResult {
  readonly provider: ProviderConnectionProvider;
  readonly connection_id: string;
  readonly display_name: string;
  readonly credential_version: number;
  readonly status: "ready" | "unknown";
}

export interface ProviderConnectionListResult {
  readonly kind: "provider_connections";
  readonly provider: ProviderConnectionProvider;
  readonly connections: readonly ProviderConnectionMetadataResult[];
}

export interface ProviderConnectionOAuthResult {
  readonly kind: "provider_connection_oauth";
  readonly provider: ProviderConnectionProvider;
  readonly operation: "connect" | "reconnect";
  readonly attempt_id: string;
  readonly connection_id: string;
  readonly requested_scope: "full_access" | null;
  readonly status: "waiting" | "ready" | "failed" | "unknown";
  readonly reason:
    | "authorization_pending"
    | "connection_ready"
    | "authorization_denied"
    | "attempt_expired"
    | "completion_unknown";
  readonly authorization_url: string | null;
  readonly expires_at: string | null;
  readonly poll_after_milliseconds: number | null;
  readonly connection: ProviderConnectionMetadataResult | null;
}

export interface ProviderConnectionListInput extends ProviderConnectionCommandBase {}

export interface ProviderConnectionOAuthBeginInput extends ProviderConnectionCommandBase {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly displayName: string;
  readonly operation: "connect" | "reconnect";
  readonly expectedCredentialVersion: number | null;
}

export interface ProviderConnectionOAuthReadInput extends ProviderConnectionCommandBase {
  readonly attemptId: string;
}
