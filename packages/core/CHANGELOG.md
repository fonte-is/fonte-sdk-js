# Release notes

## 0.2.0 — preview

Adds Broadcast Results: identify a signed-in user, record a visit, and report
actions after they are saved. Fonte matches verified email addresses to the
Broadcast's contacts.

- `@fonte-is/core/results` provides the server client.
- `@fonte-is/core/results-browser` records visits to a visible signed-in page.
- Existing PostHog server events can carry confirmation of a saved action.
- Retries retain the original event ID and time. Recovery of an old action
  requires its original saved operation and confirmed identity.
- The package includes its setup guides and Apache-2.0 license.

The Website and application v1 entry points remain available. No runtime
dependencies were added. Server entry points use ESM and require Node.js 20.9
or later.

This preview is intended for testing the full customer journey. Use an explicit
version or the `beta` tag. Promoting it to `latest` requires a fresh public
installation and verified live Results, including the failure cases.

### Upgrading from 0.1

Existing Website integrations can keep their current imports. New Broadcast
Results integrations use the two entry points above; follow the Results guide
included in `docs/results.md`.

Events queue in memory until Fonte confirms receipt. An app restart can lose
unconfirmed events. Apps that need recovery must retain the original operation
and identity details in their existing storage; the SDK adds no disk queue.
