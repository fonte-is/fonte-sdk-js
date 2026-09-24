# Internal invariants

This document is a maintenance map, not a public capability contract. Public
behavior is defined by package exports, declarations, focused tests, and the
current sanctioned ingestion contract.

## Authority boundary

- The SDK records and transports reported browser evidence.
- Browser storage is convenience state. It is never runtime authority.
- Delivery requires an explicit durable receipt matching the logical event ID.
  HTTP success alone does not prove custody. Neither establishes attribution,
  legal status, billability, or economic finality.
- The SDK writes evidence only through the sanctioned `POST /v1/touches`
  client.

## Public entry points

- `@fonte-is/core` owns browser capture.
- `@fonte-is/core/server` owns request parsing, origin acceptance, touch
  mapping, and sanctioned ingestion transport.
- `@fonte-is/react` owns React lifecycle ergonomics.
- `@fonte-is/nextjs` re-exports the React binding and the exact Core server
  collection primitive. It does not redefine either behavior.

Internal files are not public subpaths. The `exports` maps and public
declaration snapshot must remain the source of truth.

## Browser capture flow

1. `collection-policy.ts` validates the installation policy and minimizes scope.
   Unknown, denied, malformed, or expired posture grants no collection.
2. `browser-scope.ts` reads permitted evidence and optional persistent browser
   continuity. Its absolute expiry is capped by policy expiry.
3. `browser-attribution.ts` chooses the source representation; inherited Meta
   cookies do not create a new encounter. Old context caches are not custody.
4. `browser-delivery.ts` retains immutable, bounded in-memory snapshots and
   consumes explicit accepted, duplicate, ignored, rejected, or unavailable
   results. Expired snapshots cannot be renewed by changing current policy.
5. `browser.ts` allocates occurrence identity and distinct page/source IDs.
   Rerender/effect replay does not allocate another occurrence.

The browser reports evidence. Runtime owners decide acceptance and linkage.
Reported X clicks/referrers and presented source tokens establish no personal,
commercial, placement, or causal authority. Runtime idempotency conflicts,
linkage, erasure and issued-token resolution require the authoritative owner;
local fixtures cannot qualify them.

## Server collection flow

1. `collect-parse.ts` bounds streaming reads before full-body buffering, admits known keys, and
   requires matching body and scope journey identifiers.
2. `acceptScope` fails closed unless the configured canonical site origin, the
   captured URL origin, and the browser `Origin` agree.
3. `collect-classify.ts` classifies reported source signals. Classification is
   descriptive and does not decide attribution.
4. `collect-touch.ts` maps the accepted scope into the bounded touch payload.
5. `server.ts` preserves occurrence time and logical identity through the
   existing transport. Current runtime compatibility must be proved separately.

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
