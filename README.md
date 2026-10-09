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

To carry a saved action through an existing event pipeline, use the
[action confirmation guide](./docs/action-confirmations.md). The same Fonte
confirmation works with any service that can preserve its metadata.

The SDK uses ESM. Server entry points require Node.js 20.9 or later. The Core
package has no runtime dependencies.

## Existing integrations

- [Website tracking](./docs/website-tracking.md)
- [Application v1 API](./docs/application-outcomes.md)
- [React bindings](./packages/react/README.md)
- [Next.js bindings](./packages/nextjs/README.md)

Licensed under [Apache-2.0](./LICENSE).
