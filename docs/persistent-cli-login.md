# Persistent CLI login

The CLI stores one human sign-in in native OS credential custody and obtains a
fresh access token for each new process. Core remains the authority for every
workspace, environment and action. The stored record binds exact issuer, client,
scopes, Core target, redirect and authenticated UserInfo subject. Access tokens
are never persisted. A changed binding requires explicit login.

Only native macOS Keychain and Windows Credential Manager are enabled. The
pinned keyring dependency's Linux fallback cannot distinguish failed Secret
Service access from another store, so Linux sign-in is unavailable. There is no
plaintext-file, shell-command or environment fallback. Unsupported storage fails
before browser authorization.

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

The OAuth exchange uses PKCE and state validation.
Initial identity comes from the authenticated UserInfo response after exchange;
refresh requires the exact stored subject. Decoding a token alone does not
establish the signed-in person's identity.
