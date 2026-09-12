import { realpathSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { isMainThread } from "node:worker_threads";

// External test instrumentation only: no test authentication path ships in CLI.
if (isMainThread) {
  register(import.meta.url, {
    data: { mainUrl: pathToFileURL(realpathSync(process.argv[1])).href },
  });
}

let mainUrl;
export function initialize(data) {
  mainUrl = data.mainUrl;
}

const modeledImports = new Set([
  "./program.js",
  "./oauth.js",
  "./oauth-client.js",
  "./secure-login-store.js",
  "./login-lock.js",
]);

export function resolve(specifier, context, nextResolve) {
  if (context.parentURL === mainUrl && modeledImports.has(specifier)) {
    return nextResolve(
      new URL("./cli-login-signals-model.mjs", import.meta.url).href,
      context,
    );
  }
  return nextResolve(specifier, context);
}
