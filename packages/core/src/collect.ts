import { classifySourceTouch } from "./collect-classify.js";
import { acceptScope, parse } from "./collect-parse.js";
import { toTouch } from "./collect-touch.js";

export const collect = {
  parse,
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
