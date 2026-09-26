export async function resolve(specifier, context, nextResolve) {
  if (
    /\/(?:main-runtime|program|client-auth-runtime|mcp-sequence-server|local-readiness-adapter)\.js$/u.test(
      specifier,
    )
  )
    throw new Error(`Release loaded unrelated CLI runtime: ${specifier}`);
  return nextResolve(specifier, context);
}
