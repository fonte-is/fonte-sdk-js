import { classifySourceTouch } from "./collect-classify.js";
import { acceptScope, parse } from "./collect-parse.js";
import { minimizeScope, permitted } from "./collection-policy.js";
import { toTouch } from "./collect-touch.js";

export const collect = {
  parse,
  minimizeScope,
  permitted,
  acceptScope,
  classifySourceTouch,
  toTouch,
};

export type {
  CollectBody,
  CollectEventType,
  Evidence,
  ParseOptions,
  SourceTouchClassification,
  TouchPayload,
} from "./collect-types.js";

export type { CollectionPolicy } from "./collection-policy.js";
export type { CollectionReceipt } from "./collect-types.js";
