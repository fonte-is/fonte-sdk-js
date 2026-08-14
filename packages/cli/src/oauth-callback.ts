import { HostedTestBlockedError } from "./hosted-errors.js";

const CALLBACK_ORIGIN = "http://127.0.0.1:49671";
const ALLOWED_PARAMETERS = new Set([
  "code",
  "error",
  "error_description",
  "state",
]);

export function parseOAuthCallback(
  requestPath: string,
  host: string | undefined,
  expectedState: string,
): URL {
  if (host !== "127.0.0.1:49671")
    throw new HostedTestBlockedError("authorization_callback_invalid");
  const url = new URL(requestPath, CALLBACK_ORIGIN);
  if (
    url.origin !== CALLBACK_ORIGIN ||
    url.pathname !== "/callback" ||
    url.hash
  ) {
    throw new HostedTestBlockedError("authorization_callback_invalid");
  }
  if (
    [...new Set(url.searchParams.keys())].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    )
  ) {
    throw new HostedTestBlockedError("authorization_callback_invalid");
  }
  if (
    [...url.searchParams.keys()].some((key) => !ALLOWED_PARAMETERS.has(key))
  ) {
    throw new HostedTestBlockedError("authorization_callback_invalid");
  }
  if (url.searchParams.get("state") !== expectedState) {
    throw new HostedTestBlockedError("authorization_state_invalid");
  }
  const hasCode = Boolean(url.searchParams.get("code"));
  const hasError = Boolean(url.searchParams.get("error"));
  if (hasCode === hasError)
    throw new HostedTestBlockedError("authorization_callback_invalid");
  if (hasError) throw new HostedTestBlockedError("authorization_denied");
  return url;
}
