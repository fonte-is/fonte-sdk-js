import { register } from "node:module";

// This is an external proof harness. None of these hooks ship in the CLI pack.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(
    typeof input === "string" ? input : (input.url ?? input.href),
  );
  if (
    ["fonte.is", "identity.example.test", "api.example.test"].includes(
      url.hostname,
    )
  ) {
    return originalFetch(
      `${process.env.FONTE_LOGIN_PROOF_ORIGIN}${url.pathname}${url.search}`,
      options,
    );
  }
  if (url.protocol === "http:" && url.hostname === "127.0.0.1")
    return originalFetch(input, options);
  throw new Error("proof_network_boundary");
};
register(new URL("./loader.mjs", import.meta.url), {
  parentURL: import.meta.url,
  data: {
    service: process.env.FONTE_LOGIN_PROOF_SERVICE,
    user: "synthetic-operator",
    mode: process.env.FONTE_LOGIN_PROOF_STORE,
  },
});
