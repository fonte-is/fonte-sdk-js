import type { PublicWebsiteFormV1 } from "./contract.js";

export type WebsiteSubmissionIntent = {
  requestId: string;
  publicId: string;
  publishedRevision: number;
  values: { email: string; firstName?: string };
};
export type WebsiteSubmissionResult =
  | { kind: "received"; submissionId: string }
  | { kind: "completed"; submissionId: string }
  | { kind: "confirmation_required"; submissionId: string }
  | { kind: "unavailable"; retryable: boolean }
  | { kind: "revision_changed" }
  | { kind: "invalid"; field: "email" | "firstName" | null };
export type SubmitWebsiteForm = (
  intent: WebsiteSubmissionIntent,
) => Promise<WebsiteSubmissionResult>;

/** In-memory frontend intent only; HTTP receipts and admission belong to Core. */
export function createFormSubmission(
  submit: SubmitWebsiteForm,
  result: (value: WebsiteSubmissionResult) => void,
  pending: (value: boolean) => void,
) {
  let active = true;
  let busy = false;
  let intent: WebsiteSubmissionIntent | null = null;
  const finish = (value: WebsiteSubmissionResult) => {
    if (!active) return;
    busy = false;
    if (value.kind !== "unavailable" || !value.retryable) intent = null;
    pending(false);
    if (active) result(value);
  };
  return {
    get busy() {
      return busy;
    },
    change() {
      intent = null;
    },
    attempt(
      form: PublicWebsiteFormV1,
      values: WebsiteSubmissionIntent["values"],
    ) {
      if (!active || busy) return;
      try {
        if (
          !intent ||
          intent.publicId !== form.publicId ||
          intent.publishedRevision !== form.publishedRevision ||
          intent.values.email !== values.email ||
          intent.values.firstName !== values.firstName
        ) {
          intent = Object.freeze({
            requestId: crypto.randomUUID(),
            publicId: form.publicId,
            publishedRevision: form.publishedRevision,
            values: Object.freeze({ ...values }),
          });
        }
        busy = true;
        const attempt = intent;
        pending(true);
        if (!active) return;
        // The callbacks do not capture the intent, so removal releases our PII
        // references even while the injected transport promise is unresolved.
        Promise.resolve(submit(attempt)).then(finish, () =>
          finish({ kind: "unavailable", retryable: true }),
        );
      } catch {
        finish({ kind: "unavailable", retryable: true });
      }
    },
    destroy() {
      active = false;
      busy = false;
      intent = null;
    },
  };
}
