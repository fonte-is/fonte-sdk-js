import { classifySourceTouch } from "./collect-classify.js";
import { acceptScope, parse } from "./collect-parse.js";
import { toTouch, toTouchInput } from "./collect-touch.js";

export const collect = {
  parse,
  acceptScope,
  classifySourceTouch,
  toTouch,
  toTouchInput,
};

export type {
  CollectBody,
  CollectEventType,
  Evidence,
  JourneyIdentityScope,
  ParseOptions,
  SourceTouchClassification,
  TouchPayload,
} from "./collect-types.js";
export { BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION } from "./collect-types.js";
