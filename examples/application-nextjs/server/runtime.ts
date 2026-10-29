import "server-only";
import { createApplicationJourney } from "../journey";
import { existingApplicationPorts } from "./existing-ports";
import { getFonteApplicationSource } from "./source";

export const applicationJourney = createApplicationJourney(
  existingApplicationPorts,
  getFonteApplicationSource,
);
