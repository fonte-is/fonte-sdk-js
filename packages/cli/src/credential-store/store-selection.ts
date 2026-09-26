import path from "node:path";

import type { ClientAuthStore } from "../client-auth-types.js";
import { HostedTestBlockedError } from "../hosted-errors.js";
import { createOperatingSystemLoginStore } from "../secure-login-store.js";
import {
  readPrivateConfigFile,
  UserPrivateFileAuthStore,
  UserPrivateStoreFailure,
  userDataDirectory,
  USER_PRIVATE_SESSION_LIMIT_BYTES,
  writePrivateConfigFile,
  type UserPrivateFileStoreOptions,
  type WindowsFileAcl,
} from "./user-private-file-store.js";

const STORAGE_CONFIG_FILE = "storage-choice.v1.json";
const STORAGE_CONFIG_SCHEMA = "fonte.auth_storage_choice.v1";

export type AuthStorageBackend = "native" | "file";
export type AuthStorageAvailability =
  "available" | "unavailable" | "misconfigured";

export interface AuthStorageInfo {
  readonly backend: "native_secure_store" | "user_private_file" | null;
  readonly status: AuthStorageAvailability;
}

export interface ClientAuthStoreSelectorOptions extends UserPrivateFileStoreOptions {
  readonly nativeStore?: ClientAuthStore;
  readonly fileStore?: ClientAuthStore;
  readonly windowsAcl?: WindowsFileAcl;
}

/** Pins each process to the saved backend and refuses cross-process switching. */
export class ClientAuthStoreSelector implements ClientAuthStore {
  readonly #directory: string;
  readonly #platform: NodeJS.Platform;
  readonly #expectedUid: number | undefined;
  readonly #windowsAcl?: WindowsFileAcl;
  readonly #nativeStore: ClientAuthStore;
  readonly #fileStore: ClientAuthStore;
  #pinnedBackend: AuthStorageBackend | undefined;
  #availability: AuthStorageAvailability = "unavailable";

  constructor(options: ClientAuthStoreSelectorOptions = {}) {
    this.#directory = path.resolve(
      options.directory ?? userDataDirectory(options),
    );
    this.#platform = options.platform ?? process.platform;
    this.#expectedUid = options.expectedUid ?? process.getuid?.();
    this.#windowsAcl = options.windowsAcl;
    this.#nativeStore =
      options.nativeStore ?? createOperatingSystemLoginStore();
    this.#fileStore =
      options.fileStore ??
      new UserPrivateFileAuthStore({
        ...options,
        directory: this.#directory,
      });
  }

  async read(options: { allowInteraction: false; signal?: AbortSignal }) {
    return this.#dispatch((store) => store.read(options));
  }

  async replace(
    record: Parameters<ClientAuthStore["replace"]>[0],
    options: Parameters<ClientAuthStore["replace"]>[1],
  ) {
    return this.#dispatch((store) => store.replace(record, options));
  }

  async clearSession() {
    const { backend, store } = await this.#selectedStore();
    if (backend !== "file") return;
    const clear = (
      store as ClientAuthStore & { clearSession?: () => Promise<void> }
    ).clearSession;
    if (!clear) throw unavailable();
    await clear.call(store);
  }

  async selectedBackend(): Promise<AuthStorageBackend | null> {
    try {
      const configured = await this.#readChoice();
      const selected = configured ?? "native";
      if (this.#pinnedBackend && this.#pinnedBackend !== selected) return null;
      return selected;
    } catch {
      return null;
    }
  }

  async selectBackend(backend: AuthStorageBackend): Promise<void> {
    const config = Buffer.from(
      `${JSON.stringify({
        backend,
        schema: STORAGE_CONFIG_SCHEMA,
      })}\n`,
      "utf8",
    );
    try {
      await writePrivateConfigFile(
        this.#directory,
        STORAGE_CONFIG_FILE,
        config,
        this.#platform,
        this.#expectedUid,
        this.#windowsAcl,
      );
      const readback = await readPrivateConfigFile(
        this.#directory,
        STORAGE_CONFIG_FILE,
        this.#platform,
        this.#expectedUid,
        this.#windowsAcl,
      );
      if (!readback || !config.equals(readback)) throw unavailable();
      this.#pinnedBackend = backend;
      this.#availability = "unavailable";
    } catch (error) {
      this.#availability = availabilityFor(error, "file");
      throw unavailable();
    }
  }

  async storageInfo(): Promise<AuthStorageInfo> {
    try {
      const configured = await this.#readChoice();
      const backend = configured ?? "native";
      if (this.#pinnedBackend && this.#pinnedBackend !== backend) {
        return { backend: publicBackend(backend), status: "unavailable" };
      }
      return { backend: publicBackend(backend), status: this.#availability };
    } catch {
      return { backend: null, status: "misconfigured" };
    }
  }

  async #dispatch<T>(operation: (store: ClientAuthStore) => Promise<T>) {
    let selected: { backend: AuthStorageBackend; store: ClientAuthStore };
    try {
      selected = await this.#selectedStore();
    } catch (error) {
      this.#availability = "misconfigured";
      throw error;
    }
    try {
      const result = await operation(selected.store);
      this.#availability = "available";
      return result;
    } catch (error) {
      this.#availability = availabilityFor(error, selected.backend);
      throw error;
    }
  }

  async #selectedStore() {
    const configured = await this.#readChoice();
    const backend = configured ?? "native";
    if (this.#pinnedBackend === undefined) this.#pinnedBackend = backend;
    else if (this.#pinnedBackend !== backend) {
      this.#availability = "unavailable";
      throw unavailable();
    }
    return {
      backend,
      store: backend === "native" ? this.#nativeStore : this.#fileStore,
    };
  }

  async #readChoice(): Promise<AuthStorageBackend | null> {
    let payload: Buffer | null;
    try {
      payload = await readPrivateConfigFile(
        this.#directory,
        STORAGE_CONFIG_FILE,
        this.#platform,
        this.#expectedUid,
        this.#windowsAcl,
      );
    } catch (error) {
      this.#availability = availabilityFor(error, "file");
      throw unavailable();
    }
    if (payload === null) return null;
    if (payload.byteLength > USER_PRIVATE_SESSION_LIMIT_BYTES) {
      this.#availability = "misconfigured";
      throw unavailable();
    }
    try {
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(payload),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "backend,schema" ||
        (value as { schema?: unknown }).schema !== STORAGE_CONFIG_SCHEMA ||
        !["native", "file"].includes(
          String((value as { backend?: unknown }).backend),
        )
      ) {
        this.#availability = "misconfigured";
        throw unavailable();
      }
      return (value as { backend: AuthStorageBackend }).backend;
    } catch {
      this.#availability = "misconfigured";
      throw unavailable();
    }
  }
}

export function publicBackend(
  backend: AuthStorageBackend,
): AuthStorageInfo["backend"] {
  return backend === "native" ? "native_secure_store" : "user_private_file";
}

function availabilityFor(
  error: unknown,
  backend: AuthStorageBackend,
): AuthStorageAvailability {
  if (error instanceof UserPrivateStoreFailure)
    return error.kind === "misconfigured" ? "misconfigured" : "unavailable";
  if (
    backend === "file" &&
    error instanceof HostedTestBlockedError &&
    error.reason === "login_invalid"
  )
    return "misconfigured";
  return "unavailable";
}

function unavailable() {
  return new HostedTestBlockedError("secure_storage_unavailable");
}
