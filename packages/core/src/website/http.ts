import type { WebsiteObservationTransport } from "./acquisition.js";
import type {
  SubmitWebsiteForm,
  WebsiteSubmissionResult,
} from "./form-submit.js";
import { validWebsiteUuid, websiteEndpoints } from "./endpoints.js";

const unavailable = (retryable = true): WebsiteSubmissionResult => ({
  kind: "unavailable",
  retryable,
});
const MAX_RESPONSE_BYTES = 16_384;
const INTENT_AGE_MS = 24 * 60 * 60 * 1_000;

async function readJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      if (signal.aborted) throw new Error("aborted");
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("aborted");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        cancel();
        throw new Error("response_limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function mapSubmission(status: number, body: unknown): WebsiteSubmissionResult {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (
    (status === 200 || status === 201) &&
    record?.kind === "received" &&
    validWebsiteUuid(record.submissionId) &&
    Object.keys(record).length === 2
  ) {
    return { kind: "received", submissionId: record.submissionId };
  }
  if (status === 409 && record?.error === "form_revision_stale")
    return { kind: "revision_changed" };
  if (
    status === 409 &&
    record?.error === "form_submission_idempotency_conflict"
  )
    return { kind: "invalid", field: null };
  if (status === 400)
    return {
      kind: "invalid",
      field:
        record?.field === "email" || record?.field === "firstName"
          ? record.field
          : null,
    };
  if (status === 404 || status === 409 || status === 403)
    return unavailable(false);
  return unavailable();
}

/** Fixed public HTTP only; native Core remains the sole receipt/permission owner. */
export function createWebsiteHttp(options: {
  siteId: string;
  fetchImpl?: typeof fetch;
}): {
  transport: WebsiteObservationTransport;
  submit: SubmitWebsiteForm;
  destroy(): void;
} {
  const endpoints = websiteEndpoints(options.siteId);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const requests = new Set<AbortController>();
  const firstDispatch = new WeakMap<object, number>();
  let active = true;
  async function post(url: string, body: string, external?: AbortSignal) {
    if (!active || external?.aborted) throw new Error("aborted");
    const controller = new AbortController();
    requests.add(controller);
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("aborted"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      timeout = setTimeout(abort, 3_000);
    });
    const work = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw new Error("aborted");
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body,
      });
      if (!active || controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new Error("aborted");
      }
      const receipt = await readJson(response, controller.signal);
      if (!active || controller.signal.aborted) throw new Error("aborted");
      return { httpStatus: response.status, receipt };
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      external?.removeEventListener("abort", abort);
      if (rejectAbort)
        controller.signal.removeEventListener("abort", rejectAbort);
      requests.delete(controller);
    }
  }
  return {
    transport(body, signal) {
      return post(endpoints.observations, JSON.stringify(body), signal);
    },
    async submit(intent) {
      if (!active) return unavailable();
      const started = firstDispatch.get(intent) ?? Date.now();
      firstDispatch.set(intent, started);
      if (Date.now() - started >= INTENT_AGE_MS) return unavailable(false);
      if (
        !validWebsiteUuid(intent.requestId) ||
        !validWebsiteUuid(intent.publicId) ||
        !Number.isSafeInteger(intent.publishedRevision) ||
        intent.publishedRevision < 1
      )
        return { kind: "invalid", field: null };
      try {
        const body = JSON.stringify({
          requestId: intent.requestId,
          publishedRevision: intent.publishedRevision,
          values: {
            email: intent.values.email,
            ...(intent.values.firstName === undefined
              ? {}
              : { firstName: intent.values.firstName }),
          },
        });
        if (new TextEncoder().encode(body).byteLength > 2_048)
          return { kind: "invalid", field: null };
        const result = await post(endpoints.submission(intent.publicId), body);
        return mapSubmission(result.httpStatus, result.receipt);
      } catch {
        return unavailable();
      }
    },
    destroy() {
      if (!active) return;
      active = false;
      const pending = [...requests];
      requests.clear();
      for (const controller of pending) controller.abort();
    },
  };
}
