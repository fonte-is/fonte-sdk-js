# Fonte JavaScript SDK

Connect your application to Fonte to see which Broadcast recipients returned
and what they did after sending.

**0.2 is a preview.** Public npm publication and the full customer walkthrough
are still pending. The package is prepared for the `beta` tag; an unversioned
install continues to use the current stable release.

Start with the [Broadcast Results guide](./docs/results.md). It walks through
connecting your app, identifying a signed-in user, recording a saved report,
and checking Results against the saved record. Your existing authentication
and measurement permissions decide who can be measured.

Already using PostHog? Follow the [PostHog guide](./docs/posthog-selected-actions.md)
to connect your existing project and selected server events through Fonte's
integration. Both paths use the same Broadcast Results.

The SDK uses ESM. Server entry points require Node.js 20.9 or later. The Core
package has no runtime dependencies.

## Existing integrations

- [Website tracking](./docs/website-tracking.md)
- [Application v1 API](./docs/application-outcomes.md)
- [React bindings](./packages/react/README.md)
- [Next.js bindings](./packages/nextjs/README.md)

## Contributing

Read the [development rules](./docs/INTERNAL_INVARIANTS.md) before changing
identifiers, delivery, origin checks, or client lifecycle behavior.

Licensed under [Apache-2.0](./LICENSE).
