export type OperatorNextAction =
  | {
      readonly kind: "run_command";
      readonly command: string;
      readonly retry_mutation: false;
    }
  | {
      readonly kind: "stop";
      readonly reason: "candidate_manifest_unavailable";
      readonly retry_mutation: false;
    };

interface BroadcastRecoveryCommand {
  readonly kind: string;
  readonly workspace?: string;
  readonly environment?: "sandbox" | "production";
  readonly broadcastId?: string;
  readonly iterationId?: string;
  readonly connectionId?: string;
  readonly operationId?: string;
  readonly generationId?: string;
  readonly selector?: {
    readonly selectorId: string;
    readonly selectorGenerationId: string;
    readonly artifactSha256: string;
    readonly identitySetSha256: string;
    readonly candidateCount: number;
    readonly candidateManifestSha256?: string;
  };
}

interface ReceiptWithEffect {
  readonly core_effect: string;
  readonly next_action?: OperatorNextAction;
}

export function withAmbiguousBroadcastRecovery<
  Receipt extends ReceiptWithEffect,
>(command: BroadcastRecoveryCommand, receipt: Receipt): Receipt {
  if (receipt.core_effect !== "unknown") return receipt;
  const nextAction = ambiguousNextAction(command);
  if (!nextAction) return receipt;
  return {
    ...receipt,
    next_action: nextAction,
  };
}

export function renderAmbiguousBroadcastRecovery(
  receipt: ReceiptWithEffect,
): readonly string[] {
  if (receipt.core_effect !== "unknown" || !receipt.next_action) return [];
  if (receipt.next_action.kind === "stop") {
    return [
      "Authoritative readback unavailable: the Core-derived candidate manifest hash was not observed.",
      `Next action: stop (${receipt.next_action.reason}).`,
      "Retry mutation: false.",
      "Do not retry the mutation.",
    ];
  }
  return [
    `Authoritative readback: ${receipt.next_action.command}.`,
    "Retry mutation: false.",
    "Do not retry the mutation.",
  ];
}

function ambiguousNextAction(
  command: BroadcastRecoveryCommand,
): OperatorNextAction | null {
  if (
    (command.kind === "broadcast_canary" ||
      command.kind === "broadcast_control") &&
    command.workspace &&
    command.broadcastId
  ) {
    return runCommand(
      `fonte broadcast status --workspace ${argument(command.workspace)} --environment production --broadcast-id ${argument(command.broadcastId)} --json`,
    );
  }
  if (
    (command.kind === "bridge_provider_rotation_start" ||
      command.kind === "bridge_provider_rotation_advance" ||
      command.kind === "bridge_provider_rotation_seal") &&
    command.workspace &&
    command.environment &&
    command.iterationId
  ) {
    return runCommand(
      `fonte bridge rotation read --workspace ${argument(command.workspace)} --environment ${command.environment} --iteration-id ${argument(command.iterationId)} --json`,
    );
  }
  if (
    command.kind !== "provider_evidence_candidate_start" &&
    command.kind !== "provider_evidence_candidate_advance" &&
    command.kind !== "provider_evidence_candidate_seal"
  ) {
    return null;
  }
  if (
    !command.workspace ||
    !command.environment ||
    !command.connectionId ||
    !command.operationId ||
    !command.selector
  ) {
    return null;
  }
  const candidateManifestSha256 = command.selector.candidateManifestSha256;
  if (!candidateManifestSha256) {
    return {
      kind: "stop",
      reason: "candidate_manifest_unavailable",
      retry_mutation: false,
    };
  }
  const scope = providerEvidenceScope(
    command.workspace,
    command.environment,
    command.connectionId,
    { ...command.selector, candidateManifestSha256 },
  );
  if (
    command.kind === "provider_evidence_candidate_seal" &&
    command.generationId
  ) {
    return runCommand(
      `fonte provider-evidence resend generation read ${scope} --generation-id ${argument(command.generationId)} --json`,
    );
  }
  return runCommand(
    `fonte provider-evidence resend read ${scope} --operation-id ${argument(command.operationId)} --json`,
  );
}

function providerEvidenceScope(
  workspace: string,
  environment: "sandbox" | "production",
  connectionId: string,
  selector: NonNullable<BroadcastRecoveryCommand["selector"]> & {
    readonly candidateManifestSha256: string;
  },
): string {
  return [
    `--workspace ${argument(workspace)}`,
    `--environment ${environment}`,
    `--connection-id ${argument(connectionId)}`,
    `--selector-id ${argument(selector.selectorId)}`,
    `--selector-generation-id ${argument(selector.selectorGenerationId)}`,
    `--artifact-sha256 ${selector.artifactSha256}`,
    `--identity-set-sha256 ${selector.identitySetSha256}`,
    `--candidate-count ${selector.candidateCount}`,
    `--candidate-manifest-sha256 ${selector.candidateManifestSha256}`,
  ].join(" ");
}

function runCommand(command: string): OperatorNextAction {
  return { kind: "run_command", command, retry_mutation: false };
}

function argument(value: string): string {
  if (/^[A-Za-z0-9._:@/-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
