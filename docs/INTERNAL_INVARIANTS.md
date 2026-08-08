# Internal invariants

This document is a maintenance map, not a public capability contract. Public
behavior is defined by package exports, declarations, focused tests, and the
current Control Plane ingestion contract.

## Authority boundary

- The SDK records and transports reported browser evidence.
- Browser storage is convenience state. It is never runtime authority.
- Delivery means that the configured application route returned a successful
  HTTP response. It does not prove Control Plane acceptance, attribution, legal
  status, billability, or economic finality.
- The SDK writes evidence only through the sanctioned `POST /v1/touches`
  client.

## Public entry points

- `@fonte-is/core` owns browser capture.
- `@fonte-is/core/server` owns request parsing, origin acceptance, touch
  mapping, and Control Plane transport.
- `@fonte-is/react` owns React lifecycle ergonomics.
- `@fonte-is/nextjs` re-exports the React binding and the exact Core server
  collection primitive. It does not redefine either behavior.

Internal files are not public subpaths. The `exports` maps and public
declaration snapshot must remain the source of truth.

## Browser capture flow

1. `browser-scope.ts` constructs the current reported scope from bounded URL,
   referrer, first-party identifier, and advertising-source fields.
2. `browser-attribution.ts` maintains best-effort first, last, and last-paid
   browser context. Stored context does not become authoritative evidence.
3. `browser-delivery.ts` owns in-flight and completed delivery guards. A retry
   reuses the pending event ID; a completed page/event pair is deduplicated.
4. `browser.ts` validates configuration and orchestrates those components.

The browser reports observed source context. Control Plane decides whether to
accept it and what it means.

## Server collection flow

1. `collect-parse.ts` limits request size, accepts only known scope keys, and
   requires matching body and scope journey identifiers.
2. `acceptScope` fails closed unless the configured canonical site origin, the
   captured URL origin, and the browser `Origin` agree.
3. `collect-classify.ts` classifies reported source signals. Classification is
   descriptive and does not decide attribution.
4. `collect-touch.ts` maps the accepted scope into the bounded touch payload.
5. `server.ts` serializes only fields admitted by the recorded Control Plane
   fixture.

## React lifecycle

The React binding installs one shared History API observer while at least one
capture lease is active. It restores each History function only when the
installed wrapper is still present, so it does not overwrite another runtime's
later patch. Strict Mode may acquire the same capture more than once; reference
counts prevent premature release.

## Verification order

Tests import built package entry points rather than source paths. Run
`npm run build` before an isolated `npm test`, or use `npm run verify:local`,
which performs the complete clean build, strict source lint, public-contract,
pack, consumer, Node-floor, and browser sequence.
