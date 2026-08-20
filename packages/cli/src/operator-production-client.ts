import type { CoreRequester } from "./operator-core-request.js";
import {
  createProductionBroadcastClient,
  type ProductionBroadcastClient,
} from "./operator-production-broadcast-client.js";
import {
  createProductionDraftClient,
  type ProductionDraftClient,
} from "./operator-production-draft-client.js";

export interface ProductionOperatorClient
  extends ProductionDraftClient, ProductionBroadcastClient {}

export function createProductionOperatorClient(
  request: CoreRequester,
): ProductionOperatorClient {
  return {
    ...createProductionDraftClient(request),
    ...createProductionBroadcastClient(request),
  };
}
