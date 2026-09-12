let configuration;

export function initialize(data) {
  configuration = data;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith("/dist/browser.js")) {
    return {
      ...result,
      source:
        "export async function openBrowser(url) { const result = await fetch(url); return result.ok; }",
    };
  }
  if (url.endsWith("/dist/secure-login-store.js")) {
    const original =
      typeof result.source === "string"
        ? result.source
        : Buffer.from(result.source).toString("utf8");
    const factory =
      /return new OperatingSystemLoginStore\("is\.fonte\.cli", "login-v1"\);/g;
    if ([...original.matchAll(factory)].length !== 1)
      throw new Error("proof_store_factory_changed");
    const replacement =
      configuration.mode === "native"
        ? `return new OperatingSystemLoginStore(${JSON.stringify(configuration.service)}, ${JSON.stringify(configuration.user)});`
        : `return {
          async read() { return (await (await fetch(process.env.FONTE_LOGIN_PROOF_ORIGIN + "/model-store")).json()).value; },
          async write(value) { await fetch(process.env.FONTE_LOGIN_PROOF_ORIGIN + "/model-store", { method: "PUT", body: value }); },
          async remove() { await fetch(process.env.FONTE_LOGIN_PROOF_ORIGIN + "/model-store", { method: "DELETE" }); }
        };`;
    return { ...result, source: original.replace(factory, replacement) };
  }
  return result;
}
