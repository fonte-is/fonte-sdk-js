import type { FonteApplicationSource } from "@fonte-is/nextjs/application";
import type {
  CommittedPlan,
  CommittedReport,
  ExistingApplicationPorts,
  ReportInput,
  VerifiedSession,
} from "./ports.js";

/** A thin wrapper over the host app; it creates no auth, identity, or payment state. */
export function createApplicationJourney(
  ports: ExistingApplicationPorts,
  getSource: () => FonteApplicationSource | null,
  now: () => number = Date.now,
) {
  // Read neither identity-link metadata nor transaction observations without grants.
  // Contain malformed observation metadata/configuration as well as delivery failures.
  function observe(
    session: VerifiedSession,
    committed?: CommittedReport | CommittedPlan,
    kind?: "report" | "plan",
  ): void {
    try {
      const permission = session.measurementPermissions;
      if (
        permission.activity !== "granted" ||
        permission.identityLink !== "granted"
      )
        return;
      const source = getSource();
      if (!source) return;
      const membership = session.membership;
      source.recordRelationship(
        {
          eventId: membership.observationId,
          userId: session.userId,
          accountId: session.accountId,
          contactId: session.contactId,
          sourcePartyId: session.sourcePartyId ?? null,
          validFrom: membership.validFrom,
          validUntil: membership.validUntil,
          state: "verified",
        },
        permission,
      );
      source.recordAccess(
        {
          userId: session.userId,
          accountId: session.accountId,
          actor: "user",
          occurredAt: new Date(now()).toISOString(),
        },
        permission,
      );
      if (kind === "report" && committed) {
        const fact = (committed as CommittedReport).observation;
        source.recordAction(
          {
            eventId: fact.observationId,
            occurredAt: fact.committedAt,
            userId: session.userId,
            accountId: session.accountId,
            actor: "user",
            action: "report_saved",
            successful: true,
          },
          permission,
        );
      }
      if (kind === "plan" && committed) {
        const fact = (committed as CommittedPlan).observation;
        if (
          fact.priorStateVerified === true &&
          fact.previousPlan === "free" &&
          fact.effectivePlan === "pro" &&
          fact.state === "effective"
        )
          source.recordUpgrade(
            {
              eventId: fact.observationId,
              occurredAt: fact.committedAt,
              accountId: session.accountId,
              previousPlan: fact.previousPlan,
              effectivePlan: fact.effectivePlan,
              state: fact.state,
              priorStateVerified: fact.priorStateVerified,
            },
            permission,
          );
      }
    } catch {
      // Observation failure cannot change an authenticated business result.
      // Do not log the exception: it may contain host metadata or a credential.
    }
  }

  return {
    async openAccount(): Promise<{ userId: string; accountId: string }> {
      const session = await ports.requireVerifiedSession();
      const result = { userId: session.userId, accountId: session.accountId };
      observe(session);
      return result;
    },
    async saveReport(report: ReportInput) {
      const session = await ports.requireVerifiedSession();
      const committed = await ports.saveReport({
        userId: session.userId,
        accountId: session.accountId,
        report,
      });
      observe(session, committed, "report");
      return committed.result;
    },
    async upgradeToPro() {
      const session = await ports.requireVerifiedSession();
      const committed = await ports.commitPlan({
        userId: session.userId,
        accountId: session.accountId,
        requestedPlan: "pro",
      });
      observe(session, committed, "plan");
      return committed.result;
    },
  };
}
