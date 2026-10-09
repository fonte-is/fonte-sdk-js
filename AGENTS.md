# Fonte SDK JS

JavaScript SDK and CLI. Keep public APIs compatible and browser code safe to run
on customer sites. Core APIs own tenant and business state; keep credentials out
of browser bundles.

Expose Fonte primitives in the public SDK: identity, Return, successful action,
action confirmation and delivery. External event services carry these same
primitives. Do not add service-specific SDK methods, types, event constructors,
wire schemas, dependencies or setup guides. Connection-specific authentication
and field mapping belong to the existing connection owner and must consume the
shared Fonte contracts and Results engine.

Run focused tests and the build for the package being changed.
