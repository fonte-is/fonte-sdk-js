# Persistent CLI login (FON-377)

The CLI stores one human sign-in in native OS credential custody and obtains a
fresh access token for each new process. Core remains the authority for every
workspace, environment and action. The stored record binds exact issuer, client,
scopes, Core target, redirect and authenticated UserInfo subject. Access tokens
are never persisted. A changed binding requires explicit login.

Only native macOS Keychain and Windows Credential Manager are enabled. The
pinned keyring dependency's Linux fallback cannot distinguish failed Secret
Service access from another store, so Linux sign-in is unavailable. There is no
plaintext-file, shell-command or environment fallback. Unsupported storage fails
before browser authorization. Tests never use the normal CLI credential entry.

Refresh writes a non-secret, non-reusable marker before contacting the issuer.
Only the verified replacement grant restores usable custody. A crash after
rotation therefore cannot retry the previous refresh token. A loopback socket
reservation serializes credential reads, refresh, account switching and logout;
process death releases it without stale lock files. No credentials cross this
socket. Waiting processes reread custody after acquiring the reservation.

Logout needs no network discovery and verifies local deletion. Existing CLI
processes check the stored login identity again before reusing their in-memory
access. A direct auth-exec child already holding a bearer retains its existing
short lifetime; local logout makes no remote-revocation claim. Failed or canceled
login cannot report callback completion before verified storage commit.

The provider exchange uses the existing openid-client PKCE/state implementation.
Initial identity comes from the authenticated UserInfo response after exchange;
refresh requires the exact stored subject. No JWT is decoded as authority. See
[UserInfo verification](https://github.com/panva/openid-client/blob/main/docs/functions/fetchUserInfo.md)
and the [issuer's email-scope/refresh contract](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).

The package proof runs the installed CLI entrypoint in separate Node processes.
Its external test instrumentation substitutes a synthetic OAuth transport/browser
and selects a unique native credential entry, or an explicitly separate
in-memory store model. No test-only authentication path ships in the CLI. The
proof checks ten separate invocations, concurrent rotating refresh, logout and
re-login, and credential leakage across output, arguments and task files. Native
and model results must be reported separately; a blocked native probe is not a
successful fresh-machine authentication test.

The SDK's old Protocol context requirement was checked at commit
`e316efd0b0db29e2dc5f7187749de494defbcc3a`. Its canonical context manifest is
superseded and the Constitution directs ordinary repository-native development.
FON-377 explicitly updates the prior memory-only human identity contract; it adds
no provider credential or business authority.
