import {
  CoreOperatorError,
  type CoreOperatorClient,
} from "./operator-client.js";
import type {
  ProviderEvidenceCandidateTarget,
  ProviderEvidenceOperatorCommand,
} from "./operator-provider-evidence-types.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
} from "./operator-types.js";

const MAXIMUM_CANDIDATE_FILE_BYTES = 32 * 1_048_576;

export type ProviderEvidenceCandidateFileReader = (
  path: string,
) => Promise<string>;

export function isProviderEvidenceCommand(
  command: OperatorCommand,
): command is ProviderEvidenceOperatorCommand {
  return command.kind.startsWith("provider_evidence_candidate_");
}

export async function loadProviderEvidenceCandidates(
  command: ProviderEvidenceOperatorCommand,
  readFile: ProviderEvidenceCandidateFileReader,
): Promise<readonly ProviderEvidenceCandidateTarget[] | null> {
  if (command.kind !== "provider_evidence_candidate_start") return null;
  try {
    const text = await readFile(command.candidatesFile);
    if (Buffer.byteLength(text) > MAXIMUM_CANDIDATE_FILE_BYTES) invalid();
    const root = exactRecord(JSON.parse(text), ["candidates"]);
    if (
      !Array.isArray(root.candidates) ||
      root.candidates.length !== command.selector.candidateCount
    )
      invalid();
    const providerIds = new Set<string>();
    const fingerprints = new Set<string>();
    return root.candidates.map((value) => {
      const candidate = exactRecord(value, [
        "providerRecordId",
        "identityFingerprintSha256",
      ]);
      const providerRecordId = bounded(candidate.providerRecordId, 500);
      const identityFingerprintSha256 = sha256(
        candidate.identityFingerprintSha256,
      );
      if (
        providerIds.has(providerRecordId) ||
        fingerprints.has(identityFingerprintSha256)
      )
        invalid();
      providerIds.add(providerRecordId);
      fingerprints.add(identityFingerprintSha256);
      return { providerRecordId, identityFingerprintSha256 };
    });
  } catch (error) {
    if (error instanceof CoreOperatorError) throw error;
    return invalid();
  }
}

export async function executeProviderEvidenceCommand(
  command: ProviderEvidenceOperatorCommand,
  client: CoreOperatorClient,
  candidates: readonly ProviderEvidenceCandidateTarget[] | null,
): Promise<
  Extract<
    OperatorResult,
    {
      readonly kind:
        | "provider_evidence_candidate_acquisition"
        | "provider_evidence_candidate_generation";
    }
  >
> {
  const scope = {
    workspace: command.workspace,
    environment: command.environment,
    connectionId: command.connectionId,
    selector: command.selector,
  };
  if (command.kind === "provider_evidence_candidate_start") {
    if (!candidates) invalid();
    return client.startResendCandidateEvidence({
      ...scope,
      operationId: command.operationId,
      candidates,
      schemaVersion: command.schemaVersion,
      normalizationVersion: command.normalizationVersion,
      identityFingerprintVersion: command.identityFingerprintVersion,
      identityCustody: command.identityCustody,
    });
  }
  if (command.kind === "provider_evidence_candidate_read") {
    return client.readResendCandidateEvidence({
      ...scope,
      operationId: command.operationId,
    });
  }
  if (command.kind === "provider_evidence_candidate_advance") {
    return client.advanceResendCandidateEvidence({
      ...scope,
      operationId: command.operationId,
      expectedRequestNumber: command.expectedRequestNumber,
    });
  }
  if (command.kind === "provider_evidence_candidate_seal") {
    return client.sealResendCandidateEvidence({
      ...scope,
      operationId: command.operationId,
      generationId: command.generationId,
    });
  }
  return client.readResendCandidateEvidenceGeneration({
    ...scope,
    generationId: command.generationId,
  });
}

export function providerEvidenceReceiptDescriptor(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
): {
  readonly outcome: "completed" | "terminal";
  readonly reason: string;
  readonly coreEffect: OperatorReceipt["core_effect"];
} | null {
  if (result.kind === "provider_evidence_candidate_acquisition") {
    return {
      outcome: result.status === "sealed" ? "terminal" : "completed",
      reason: `provider_evidence_candidate_${result.status}`,
      coreEffect:
        command.kind === "provider_evidence_candidate_read"
          ? "none"
          : "attempted",
    };
  }
  if (result.kind === "provider_evidence_candidate_generation") {
    return {
      outcome: "terminal",
      reason: "provider_evidence_candidate_generation_sealed",
      coreEffect:
        command.kind === "provider_evidence_candidate_generation_read"
          ? "none"
          : "attempted",
    };
  }
  return null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    invalid();
  return body;
}

function bounded(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  )
    invalid();
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

function invalid(): never {
  throw new CoreOperatorError(
    "provider_evidence_candidate_request_invalid",
    null,
    "none",
  );
}
