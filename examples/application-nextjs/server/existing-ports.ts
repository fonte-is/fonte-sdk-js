import "server-only";
import type { ExistingApplicationPorts } from "../ports.js";

// Replace these three bindings with imports from YOUR existing session, report,
// and entitlement services. An unbound reference must never authenticate a user,
// pretend to commit a report, or grant an entitlement.
export const existingApplicationPorts: ExistingApplicationPorts = {
  async requireVerifiedSession() {
    throw new Error("reference_session_port_not_bound");
  },
  async saveReport() {
    throw new Error("reference_report_port_not_bound");
  },
  async commitPlan() {
    throw new Error("reference_entitlement_port_not_bound");
  },
};
