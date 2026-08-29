import {
  normalizeCollectionPostureRuntime,
  type CollectionPostureRuntimeConfig,
} from "./collection-posture.js";
import { diagnosticCode, FonteApiError } from "./server-errors.js";

interface ReadCollectionPostureInput {
  baseUrl: string;
  environment: "sandbox" | "production";
  headers: Record<string, string>;
  tenantId?: string;
  timeoutMs: number;
}

export async function readCollectionPosture(
  input: ReadCollectionPostureInput,
): Promise<CollectionPostureRuntimeConfig> {
  const path = "/v1/collection-posture/current";
  const query = new URLSearchParams({ environment: input.environment });
  if (input.tenantId) query.set("tenantId", input.tenantId);
  const response = await fetch(`${input.baseUrl}${path}?${query.toString()}`, {
    method: "GET",
    headers: input.headers,
    signal: AbortSignal.timeout(input.timeoutMs),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new FonteApiError({
      path,
      status: response.status,
      code: diagnosticCode(body),
      operation: "read",
    });
  }
  const posture = normalizeCollectionPostureRuntime(body);
  if (!posture) {
    throw new FonteApiError({
      path,
      status: response.status,
      code: "invalid_collection_posture_receipt",
      operation: "read",
    });
  }
  return posture;
}
