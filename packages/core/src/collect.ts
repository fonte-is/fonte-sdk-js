import { acceptScope, parse } from "./collect-parse.js";
import {
  minimizeScope,
  minimizeSourceEvidence,
  permitted,
} from "./collection-policy.js";
export const collect = {
  parse,
  minimizeScope,
  minimizeSourceEvidence,
  permitted,
  acceptScope,
};
export type {
  CollectBody,
  CollectEventType,
  Evidence,
  ParseOptions,
  CollectionReceipt,
} from "./collect-types.js";
export type { CollectionPolicy } from "./collection-policy.js";
export type { SourceFields, SourceEvidence } from "./source-evidence.js";
