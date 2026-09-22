import { canonicalJson } from "./canonical-json.js";
import type {
  ClientAuthStore,
  ClientSessionRecord,
} from "./client-auth-types.js";
import {
  loadNativeClientAuthStore,
  type NativeClientAuthStore,
} from "./credential-store/native-loader.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { parseSessionRecord } from "./persistent-login-record.js";

const MAX_PAYLOAD_BYTES = 2_400;

interface StoreReadOptions {
  readonly allowInteraction: false;
  readonly signal?: AbortSignal;
}

interface StoreReplaceOptions {
  readonly allowInteraction: boolean;
  readonly signal?: AbortSignal;
}

/** Compatibility surface retained until FON-679 switches CLI composition. */
export interface SecureLoginStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export class OperatingSystemLoginStore
  implements ClientAuthStore, SecureLoginStore
{
  #native: Promise<NativeClientAuthStore> | undefined;

  constructor(
    private readonly loadNative: () => Promise<NativeClientAuthStore> = () =>
      loadNativeClientAuthStore(),
    private readonly noninteractive: () => boolean = () =>
      process.env.FONTE_NONINTERACTIVE === "1",
  ) {}

  read(): Promise<string | null>;
  read(options: StoreReadOptions): Promise<ClientSessionRecord | null>;
  async read(
    options?: StoreReadOptions,
  ): Promise<string | ClientSessionRecord | null> {
    const record = await this.#readRecord(options?.signal);
    if (record === null || options) return record;
    return canonicalJson(record);
  }

  async replace(
    record: ClientSessionRecord,
    options: StoreReplaceOptions,
  ): Promise<void> {
    active(options.signal);
    const validated = parseSessionRecord(record);
    const payload = encode(validated);
    const native = await this.#binding();
    active(options.signal);
    const permitInteraction =
      !this.noninteractive() &&
      options.allowInteraction &&
      (validated.state === "login_pending" || validated.state === "ready");

    await settled(() => native.replace(payload, permitInteraction), "replace");
    const readback = await settled(() => native.read(), "readback");
    if (!Buffer.isBuffer(readback) || !payload.equals(readback)) {
      throw blocked("login_invalid");
    }
    active(options.signal);
  }

  async write(value: string): Promise<void> {
    await this.replace(parseSessionRecord(value), { allowInteraction: true });
  }

  async remove(): Promise<void> {
    throw blocked("secure_storage_unavailable");
  }

  async #readRecord(signal?: AbortSignal): Promise<ClientSessionRecord | null> {
    active(signal);
    const native = await this.#binding();
    active(signal);
    const payload = await dispatched(() => native.read(), signal, "read");
    if (payload === null) return null;
    if (!Buffer.isBuffer(payload)) throw blocked("login_invalid");
    return decode(payload);
  }

  #binding(): Promise<NativeClientAuthStore> {
    this.#native ??= this.loadNative().catch(() => {
      throw blocked("secure_storage_unavailable");
    });
    return this.#native;
  }
}

export function createOperatingSystemLoginStore(): OperatingSystemLoginStore {
  return new OperatingSystemLoginStore();
}

function encode(record: ClientSessionRecord): Buffer {
  const payload = Buffer.from(canonicalJson(record), "utf8");
  if (payload.byteLength > MAX_PAYLOAD_BYTES) throw blocked("login_invalid");
  return payload;
}

function decode(payload: Buffer): ClientSessionRecord {
  if (payload.byteLength > MAX_PAYLOAD_BYTES) throw blocked("login_invalid");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw blocked("login_invalid");
  }
  const record = parseSessionRecord(text);
  if (!payload.equals(encode(record))) throw blocked("login_invalid");
  return record;
}

async function dispatched<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  phase: "read" | "replace" | "readback",
): Promise<T> {
  try {
    const result = await operation();
    active(signal);
    return result;
  } catch (error) {
    active(signal);
    const code = nativeCode(error);
    if (phase === "read" && code === "item_not_found") return null as T;
    if (
      code === "interaction_required" ||
      code === "locked" ||
      code === "prompt_required"
    )
      throw blocked("secure_storage_interaction_required");
    if (code === "invalid" || code === "duplicate" || code === "wrong_metadata")
      throw blocked("login_invalid");
    throw blocked("secure_storage_unavailable");
  }
}

async function settled<T>(
  operation: () => Promise<T>,
  phase: "replace" | "readback",
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = nativeCode(error);
    if (
      phase === "replace" &&
      ["interaction_required", "locked", "prompt_required"].includes(code ?? "")
    )
      throw blocked("secure_storage_interaction_required");
    if (code === "invalid" || code === "duplicate" || code === "wrong_metadata")
      throw blocked("login_invalid");
    // A dispatched mutation or its failed readback has an unknown effect.
    throw blocked("secure_storage_unavailable");
  }
}

function nativeCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.message !== "string") return undefined;
  const prefix = "fonte_store_";
  return candidate.message.startsWith(prefix)
    ? candidate.message.slice(prefix.length)
    : undefined;
}

function active(signal?: AbortSignal) {
  if (signal?.aborted) throw blocked("authorization_cancelled");
}

function blocked(reason: string): HostedTestBlockedError {
  return new HostedTestBlockedError(reason);
}
