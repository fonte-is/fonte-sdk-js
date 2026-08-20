import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { AuthorizedConsumerDependencies } from "./runtime-types.js";

export async function runAuthorizedConsumer(
  command: string,
  args: readonly string[],
  dependencies: AuthorizedConsumerDependencies,
): Promise<void> {
  assertActive(dependencies.signal);
  const config = await loadHostedConfig(
    dependencies.fetch as typeof fetch,
    dependencies.configUrl,
  );
  assertActive(dependencies.signal);
  const bearer = await dependencies.authorize(config, dependencies.signal);
  if (!bearer.trim()) {
    throw new HostedTestBlockedError("authorization_token_missing");
  }
  assertActive(dependencies.signal);
  await dependencies.spawn(command, args, bearer, dependencies.signal);
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new HostedTestBlockedError("authorization_cancelled");
  }
}
