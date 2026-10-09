# Persistent CLI login

The CLI stores one human sign-in in the selected credential store and obtains a
fresh access token for each new process. Core remains the authority for every
workspace, environment and action. The stored record binds exact issuer, client,
scopes, Core target, redirect and authenticated UserInfo subject. Access tokens
are never persisted. A changed binding requires explicit login.

Native OS credential storage is the default when the packaged helper and OS
service are available. If native storage is unavailable before browser sign-in,
interactive `fonte auth login` can offer a per-user session file. The user must
explicitly accept that choice. The file contains the refresh credential and is
not encrypted by the CLI; restrictive permissions protect it from other OS
users, not processes running as the same user. The selected backend persists
across processes. Ordinary commands never choose another backend automatically.
`fonte auth status --json` reports the backend and its availability. An
unavailable or misconfigured selected store blocks authenticated work.

Refresh writes a non-secret, non-reusable marker before contacting the issuer.
Only the verified replacement grant restores usable custody. A crash after
rotation therefore cannot retry the previous refresh token. A loopback socket
reservation serializes credential reads, refresh, account switching and logout;
process death releases it without stale lock files. No credentials cross this
socket. Waiting processes reread custody after acquiring the reservation.

Logout needs no network discovery and verifies removal of the local refresh
credential. Existing CLI
processes check the stored login identity again before reusing their in-memory
access. A direct auth-exec child already holding a bearer retains its existing
short lifetime; local logout makes no remote-revocation claim. Failed or canceled
login cannot report callback completion before verified storage commit.

The OAuth exchange uses PKCE and state validation.
Initial identity comes from the authenticated UserInfo response after exchange;
refresh requires the exact stored subject. Decoding a token alone does not
establish the signed-in person's identity.
