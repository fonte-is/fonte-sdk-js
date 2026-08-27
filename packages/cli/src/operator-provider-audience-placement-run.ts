import { CoreOperatorError } from "./operator-client.js";
import { providerPlacementApplicationFile } from "./operator-provider-audience-placement-input.js";
import type {
  ProviderPlacementApplicationInput,
  ProviderPlacementApplicationResult,
  ProviderPlacementOperatorCommand,
} from "./operator-provider-audience-placement-types.js";
import type { CoreOperatorClient } from "./operator-client.js";
import type { OperatorCommand } from "./operator-types.js";

const MAXIMUM_APPLICATION_FILE_BYTES = 512 * 1_024;

export type ProviderPlacementApplicationFileReader = (
  path: string,
) => Promise<string>;

export function isProviderPlacementCommand(
  command: OperatorCommand,
): command is ProviderPlacementOperatorCommand {
  return (
    command.kind === "bridge_provider_placement_apply" ||
    command.kind === "bridge_provider_placement_progress"
  );
}

export async function loadProviderPlacementApplication(
  command: ProviderPlacementOperatorCommand,
  readFile: ProviderPlacementApplicationFileReader,
): Promise<ProviderPlacementApplicationInput> {
  try {
    const text = await readFile(command.applicationFile);
    if (Buffer.byteLength(text) > MAXIMUM_APPLICATION_FILE_BYTES) invalid();
    return providerPlacementApplicationFile(
      JSON.parse(text),
      command.environment,
    );
  } catch (error) {
    if (error instanceof CoreOperatorError) throw error;
    return invalid();
  }
}

export function executeProviderPlacementCommand(
  command: ProviderPlacementOperatorCommand,
  client: CoreOperatorClient,
  application: ProviderPlacementApplicationInput | null,
): Promise<ProviderPlacementApplicationResult> {
  if (!application) invalid();
  const input = {
    workspace: command.workspace,
    environment: command.environment,
    application,
  };
  return command.kind === "bridge_provider_placement_apply"
    ? client.applyProviderPlacement(input)
    : client.readProviderPlacement(input);
}

export function providerPlacementReceiptDescriptor(
  command: OperatorCommand,
  result: ProviderPlacementApplicationResult,
): {
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect: "none" | "unknown";
} {
  return {
    outcome: result.status === "complete" ? "completed" : "blocked",
    reason:
      result.reason_code ?? `provider_placement_application_${result.status}`,
    coreEffect:
      command.kind === "bridge_provider_placement_apply" ? "unknown" : "none",
  };
}

function invalid(): never {
  throw new CoreOperatorError(
    "provider_placement_application_request_invalid",
    null,
    "none",
  );
}
