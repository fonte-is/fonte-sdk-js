import type { ApplicationPermission } from "@fonte-is/nextjs/application";

/** Bind these ports to the host application's existing verified session and stores. */
export interface VerifiedSession {
  userId: string;
  accountId: string;
  contactId: string;
  sourcePartyId?: string | null;
  membership: {
    /** Stable UUID of this existing, verified membership observation. */
    observationId: string;
    validFrom: string;
    validUntil: string | null;
  };
  measurementPermissions: ApplicationPermission;
}

export interface ReportInput {
  title: string;
  body: string;
}
export interface SavedReport {
  reportId: string;
  title: string;
}
export interface CommittedReport {
  result: SavedReport;
  /** Persist these values with the transaction; reuse them on a business replay. */
  observation: { observationId: string; committedAt: string };
}

export interface PlanResult {
  plan: string;
  state: "effective" | "pending";
}
export interface CommittedPlan {
  result: PlanResult;
  /** Facts read from the entitlement transaction, never a checkout or client claim. */
  observation: {
    observationId: string;
    committedAt: string;
    previousPlan: string | null;
    effectivePlan: string;
    state: "effective" | "pending";
    priorStateVerified: boolean;
  };
}

export interface ExistingApplicationPorts {
  requireVerifiedSession(): Promise<VerifiedSession>;
  saveReport(input: {
    userId: string;
    accountId: string;
    report: ReportInput;
  }): Promise<CommittedReport>;
  commitPlan(input: {
    userId: string;
    accountId: string;
    requestedPlan: "pro";
  }): Promise<CommittedPlan>;
}
