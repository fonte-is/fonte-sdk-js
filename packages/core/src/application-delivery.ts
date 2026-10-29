import type {
  ApplicationDeliveryReason,
  ApplicationDeliveryStatus,
  FonteApplicationSourceOptions,
} from "./application-types.js";

// Internal closed protocols. No custom endpoint, header, receipt or credential plug-in is public.
type CommonOptions = Omit<
  FonteApplicationSourceOptions,
  "siteId" | "sourceId" | "origin" | "policyVersion" | "serverKey"
> & { sourceId: string };
type ServerOptions = CommonOptions &
  (
    | {
        mode: "application-v1";
        siteId: string;
        origin: string;
        policyVersion: string;
        serverKey: string;
      }
    | { mode: "application-v2"; serverKey: string }
  );
type BrowserOptions = CommonOptions & { identityToken: string };
type Protocol = {
  endpoint: string;
  headers: Record<string, string>;
  schema: "fonte.application.v1" | "fonte.application.v2";
  receiptSchema:
    "fonte.application.receipt.v1" | "fonte.application.receipt.v2";
  policyVersion: string;
  browserPrefix: string | null;
};
const idPattern = /^[a-zA-Z0-9_.:-]{1,200}$/;
const instantPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const maxBytes = 65_536;
const maxRetryDelayMs = 2_000;
const maxRetryAfterMs = 86_400_000;
const byteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;
type ObjectValue = Record<string, unknown>;
type AcknowledgedRecord = { eventId: string; outcome: "stored" | "replayed" | "erased" };
type Acknowledgement = {
  outcome: AcknowledgedRecord["outcome"] | null;
  sourceRevision: number | null;
};
type Queued = { eventId: string; body: string; bytes: number; acknowledgement: Acknowledgement };
type RequestResult =
  | { kind: "ack"; records: AcknowledgedRecord[]; sourceRevision: number | null }
  | { kind: "permanent"; reason: ApplicationDeliveryReason }
  | { kind: "retry"; reason: ApplicationDeliveryReason; delay?: number };

function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw 0;
  return value as ObjectValue;
}
function keys(value: ObjectValue, names: string[]): void {
  if (
    names.some((name) => !Object.hasOwn(value, name)) ||
    Object.keys(value).some((name) => !names.includes(name))
  )
    throw 0;
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !instantPattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw 0;
  const canonical = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_whole, digits: string | undefined) =>
      `.${(digits ?? "000").padEnd(3, "0")}Z`,
  );
  if (new Date(value).toISOString() !== canonical) throw 0;
  return canonical;
}
function configurationInvalid(): never {
  throw new Error("fonte_application_configuration_invalid");
}
function origin(value: unknown, local: boolean): string {
  try {
    if (typeof value !== "string") return configurationInvalid();
    const url = new URL(value);
    if (
      value !== url.origin ||
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (local &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      return configurationInvalid();
    return url.origin;
  } catch {
    return configurationInvalid();
  }
}
function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    return configurationInvalid();
  return value;
}
function retryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1_000
    : Date.parse(value) - now;
  return Number.isFinite(milliseconds) &&
    milliseconds >= 0 &&
    milliseconds <= maxRetryAfterMs
    ? Math.ceil(milliseconds)
    : undefined;
}
async function readReceipt(
  response: Response,
  expected: Queued[],
  sourceId: string,
  signal: AbortSignal,
  receiptSchema: string,
): Promise<RequestResult> {
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return { kind: "retry", reason: "receipt_unconfirmed" };
  const chunks: Uint8Array[] = [];
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) return { kind: "retry", reason: "receipt_unconfirmed" };
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { kind: "retry", reason: "receipt_unconfirmed" };
      }
      chunks.push(next.value);
    }
    if (signal.aborted) return { kind: "retry", reason: "receipt_unconfirmed" };
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Preserve the v1 Buffer UTF-8 behavior: a leading BOM is invalid JSON, not discarded.
    const v = object(
      JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(joined)),
    );
    keys(v, ["schema", "sourceId", "acceptedAt", "records", "delivery"]);
    if (
      v.schema !== receiptSchema ||
      v.sourceId !== sourceId ||
      v.delivery !== "best_effort" ||
      !Array.isArray(v.records) ||
      v.records.length !== expected.length
    )
      throw 0;
    instant(v.acceptedAt);
    const pending = new Set(expected.map((entry) => entry.eventId));
    const records = v.records.map<AcknowledgedRecord>((value) => {
      const r = object(value);
      keys(r, ["eventId", "outcome"]);
      if (
        typeof r.eventId !== "string" ||
        !pending.delete(r.eventId) ||
        (r.outcome !== "stored" &&
          r.outcome !== "replayed" &&
          r.outcome !== "erased")
      )
        throw 0;
      return { eventId: r.eventId, outcome: r.outcome };
    });
    const revision = response.headers.get("x-fonte-source-revision");
    const sourceRevision = receiptSchema === "fonte.application.receipt.v2" && revision !== null
      && /^[1-9][0-9]{0,15}$/.test(revision) && Number.isSafeInteger(Number(revision))
      ? Number(revision) : null;
    return { kind: "ack", records, sourceRevision };
  } catch {
    return { kind: "retry", reason: "receipt_unconfirmed" };
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function createApplicationDelivery<
  RecordType extends { eventId: string },
>(
  options: ServerOptions,
  normalizeRecord: (value: unknown, now: number) => RecordType,
) {
  const apiOrigin = origin(
    options.apiOrigin ?? "https://api.fonte.is",
    options.allowInsecureLocalhost === true,
  );
  if (
    typeof options.serverKey !== "string" ||
    !/^[\x21-\x7e]{24,512}$/.test(options.serverKey)
  )
    configurationInvalid();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let endpoint = `${apiOrigin}/v1/application-observations`;
  if (options.mode === "application-v1") {
    if (
      typeof options.siteId !== "string" ||
      !/^site_[a-zA-Z0-9_-]{32}$/.test(options.siteId) ||
      typeof options.policyVersion !== "string" ||
      !idPattern.test(options.policyVersion)
    )
      configurationInvalid();
    endpoint = `${apiOrigin}/v1/websites/${options.siteId}/application-observations`;
    headers.Origin = origin(
      options.origin,
      options.allowInsecureLocalhost === true,
    );
  }
  headers["x-fonte-installation-id"] = options.sourceId;
  headers["x-fonte-installation-key"] = options.serverKey;
  return applicationDelivery(
    options,
    {
      endpoint,
      headers,
      schema:
        options.mode === "application-v1"
          ? "fonte.application.v1"
          : "fonte.application.v2",
      receiptSchema:
        options.mode === "application-v1"
          ? "fonte.application.receipt.v1"
          : "fonte.application.receipt.v2",
      policyVersion:
        options.mode === "application-v1"
          ? options.policyVersion
          : "fonte_measurement.v1",
      browserPrefix: null,
    },
    normalizeRecord,
  );
}

// A separate closed factory lets browser bundlers remove every credential-bearing server branch.
export function createBrowserReturnDelivery<
  RecordType extends { eventId: string },
>(
  options: BrowserOptions,
  normalizeRecord: (value: unknown, now: number) => RecordType,
) {
  const apiOrigin = origin(
    options.apiOrigin ?? "https://api.fonte.is",
    options.allowInsecureLocalhost === true,
  );
  if (
    typeof options.identityToken !== "string" ||
    options.identityToken.length === 0 ||
    byteLength(options.identityToken) > 4096 ||
    /[\s\u0000-\u001f\u007f]/.test(options.identityToken)
  )
    configurationInvalid();
  return applicationDelivery(
    { ...options, queueLimit: 1, batchSize: 1 },
    {
      endpoint: `${apiOrigin}/v1/application-returns`,
      headers: { "Content-Type": "application/json" },
      schema: "fonte.application.v2",
      receiptSchema: "fonte.application.receipt.v2",
      policyVersion: "fonte_measurement.v1",
      browserPrefix:
        JSON.stringify({ identityToken: options.identityToken }).slice(0, -1) +
        ',"record":',
    },
    normalizeRecord,
  );
}

function applicationDelivery<RecordType extends { eventId: string }>(
  options: CommonOptions,
  protocol: Protocol,
  normalizeRecord: (value: unknown, now: number) => RecordType,
) {
  const sourceId = options.sourceId;
  if (
    typeof sourceId !== "string" ||
    !idPattern.test(sourceId) ||
    (options.fetch !== undefined && typeof options.fetch !== "function") ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    configurationInvalid();
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== "function") configurationInvalid();
  const { endpoint, headers, receiptSchema, browserPrefix } = protocol;
  const queueLimit = bounded(options.queueLimit, 1_000, 1, 1_000);
  const batchSize = bounded(options.batchSize, 100, 1, 100);
  const timeoutMs = bounded(options.timeoutMs, 750, 1, 750);
  const flushDelayMs = bounded(options.flushDelayMs, 25, 0, 1_000);
  const retryBaseMs = bounded(options.retryBaseMs, 100, 1, maxRetryDelayMs);
  const maxRetries = bounded(options.maxRetries, 3, 0, 3);
  const now = options.now ?? Date.now;
  const clock = () => {
    try {
      const n = now();
      return Number.isFinite(n) ? n : Date.now();
    } catch {
      return Date.now();
    }
  };
  const prefix =
    JSON.stringify({
      schema: protocol.schema,
      sourceId,
      policy: {
        version: protocol.policyVersion,
        activity: "granted",
        identityLink: "granted",
      },
    }).slice(0, -1) + ',"records":[';
  const overhead =
    byteLength(browserPrefix ?? prefix) + (browserPrefix === null ? 2 : 1);
  const queue: Queued[] = [],
    pendingIds = new Map<string, Queued>();
  const counts = {
    enqueued: 0,
    acknowledged: 0,
    stored: 0,
    replayed: 0,
    erased: 0,
    dropped: 0,
    denied: 0,
    rejected: 0,
    requests: 0,
    retries: 0,
  };
  let state: ApplicationDeliveryStatus["state"] = "ready";
  let lastReason: ApplicationDeliveryReason | null = null;
  let retryAt = 0,
    scheduled: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<ApplicationDeliveryStatus> | null = null,
    controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null,
    wakeRetry: (() => void) | null = null;
  const status = (): ApplicationDeliveryStatus => ({
    delivery: "best_effort",
    state,
    queued: queue.length,
    ...counts,
    retryAfterMs: Math.max(0, retryAt - clock()),
    lastReason,
  });
  const stop = () => state === "closed" || state === "blocked";
  const drop = () => {
    counts.dropped += queue.length;
    queue.length = 0;
    pendingIds.clear();
  };
  const reject = (reason: ApplicationDeliveryReason) => {
    counts.rejected++;
    lastReason = reason;
    return false;
  };
  const gate = (permission: boolean) => {
    if (permission !== true) {
      counts.denied++;
      lastReason = "collection_not_permitted";
      return false;
    }
    if (stop())
      return reject(
        state === "closed" ? "closed" : (lastReason ?? "source_rejected"),
      );
    return true;
  };
  const sleep = (delay: number) =>
    new Promise<void>((done) => {
      wakeRetry = done;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        wakeRetry = null;
        done();
      }, delay);
    });
  const request = async (
    body: string,
    batch: Queued[],
  ): Promise<RequestResult> => {
    const current = new AbortController();
    controller = current;
    let timeout = false,
      interrupt: (() => void) | null = null;
    const interrupted = new Promise<RequestResult>((done) => {
      interrupt = () =>
        done({ kind: "retry", reason: timeout ? "request_timeout" : "closed" });
      current.signal.addEventListener("abort", interrupt, { once: true });
    });
    const timer = setTimeout(() => {
      timeout = true;
      current.abort();
    }, timeoutMs);
    const perform = async (): Promise<RequestResult> => {
      try {
        const response = await transport(endpoint, {
          method: "POST",
          headers: { ...headers },
          body,
          signal: current.signal,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        });
        if (current.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          return {
            kind: "retry",
            reason: timeout ? "request_timeout" : "closed",
          };
        }
        if (!response.ok) void response.body?.cancel().catch(() => undefined);
        if (response.status === 401 || response.status === 403)
          return { kind: "permanent", reason: "source_denied" };
        if (response.status === 409)
          return { kind: "permanent", reason: "source_conflict" };
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 425, 429].includes(response.status)
        )
          return { kind: "permanent", reason: "source_rejected" };
        if (!response.ok)
          return {
            kind: "retry",
            reason: "source_unavailable",
            delay: retryAfter(response.headers.get("Retry-After"), clock()),
          };
        return await readReceipt(
          response,
          batch,
          sourceId,
          current.signal,
          receiptSchema,
        );
      } catch {
        return { kind: "retry", reason: "network_unavailable" };
      }
    };
    try {
      return await Promise.race([perform(), interrupted]);
    } finally {
      clearTimeout(timer);
      if (interrupt) current.signal.removeEventListener("abort", interrupt);
      if (controller === current) controller = null;
    }
  };
  const batchFrom = (remaining: number): Queued[] => {
    const batch: Queued[] = [];
    let bytes = overhead;
    for (const item of queue) {
      const added = item.bytes + (batch.length ? 1 : 0);
      if (
        batch.length >= Math.min(batchSize, remaining) ||
        bytes + added > maxBytes
      )
        break;
      batch.push(item);
      bytes += added;
    }
    return batch;
  };
  const drain = async () => {
    if (stop() || !queue.length) return;
    if (retryAt > clock()) {
      state = "disconnected";
      lastReason = "retry_later";
      return;
    }
    retryAt = 0;
    state = "delivering";
    let remaining = queue.length;
    while (remaining > 0 && queue.length && !stop()) {
      const batch = batchFrom(remaining),
        body =
          browserPrefix === null
            ? prefix + batch.map((item) => item.body).join(",") + "]}"
            : browserPrefix + batch[0]!.body + "}";
      for (let attempt = 0; attempt <= maxRetries && !stop(); attempt++) {
        counts.requests++;
        if (attempt > 0) counts.retries++;
        const result = await request(body, batch);
        if (stop()) return;
        if (result.kind === "ack") {
          for (const record of result.records) {
            counts[record.outcome]++;
            const item = pendingIds.get(record.eventId)!;
            item.acknowledgement.outcome = record.outcome;
            item.acknowledgement.sourceRevision = record.outcome === "erased" ? null : result.sourceRevision;
          }
          counts.acknowledged += batch.length;
          for (const item of batch) pendingIds.delete(item.eventId);
          queue.splice(0, batch.length);
          remaining -= batch.length;
          lastReason = null;
          break;
        }
        lastReason = result.reason;
        if (result.kind === "permanent") {
          state = "blocked";
          drop();
          return;
        }
        if (result.delay !== undefined && result.delay > maxRetryDelayMs) {
          retryAt = clock() + result.delay;
          state = "disconnected";
          lastReason = "retry_later";
          return;
        }
        if (attempt === maxRetries) {
          state = "disconnected";
          return;
        }
        await sleep(
          Math.max(
            result.delay ?? 0,
            Math.min(retryBaseMs * 2 ** attempt, maxRetryDelayMs),
          ),
        );
      }
    }
    if (!stop()) state = "ready";
  };
  const schedule = () => {
    if (
      scheduled !== null ||
      active !== null ||
      stop() ||
      !queue.length ||
      retryAt > clock()
    )
      return;
    scheduled = setTimeout(() => {
      scheduled = null;
      void flush();
    }, flushDelayMs);
    scheduled.unref?.();
  };
  const flush = (): Promise<ApplicationDeliveryStatus> => {
    if (scheduled !== null) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    if (active) return active;
    active = Promise.resolve()
      .then(drain)
      .catch(() => {
        if (!stop()) {
          state = "disconnected";
          lastReason = "network_unavailable";
        }
      })
      .then(() => status())
      .finally(() => {
        active = null;
        if (state === "ready") schedule();
      });
    return active;
  };
  const enqueue = (value: unknown, permission: boolean): boolean => {
    if (!gate(permission)) return false;
    try {
      const record = normalizeRecord(value, clock()),
        body = JSON.stringify(record),
        bytes = byteLength(body);
      if (bytes + overhead > maxBytes) return reject("record_invalid");
      const pending = pendingIds.get(record.eventId);
      if (pending !== undefined)
        return pending.body === body || reject("record_conflict");
      if (queue.length >= queueLimit) {
        counts.dropped++;
        return reject("queue_full");
      }
      const item: Queued = { eventId: record.eventId, body, bytes,
        acknowledgement: { outcome: null, sourceRevision: null } };
      queue.push(item);
      pendingIds.set(record.eventId, item);
      counts.enqueued++;
      schedule();
      return true;
    } catch {
      return reject("record_invalid");
    }
  };
  return {
    enqueue,
    // A handle retains only its own queued record's cell. No revision cache or extra request.
    acknowledgement: (eventId: string): Readonly<Acknowledgement> | null =>
      pendingIds.get(eventId)?.acknowledgement ?? null,
    gate,
    reject,
    clock,
    flush,
    status,
    close() {
      if (state === "closed") return status();
      state = "closed";
      lastReason = "closed";
      retryAt = 0;
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      wakeRetry?.();
      wakeRetry = null;
      controller?.abort();
      drop();
      return status();
    },
  };
}
