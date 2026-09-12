import { HostedTestBlockedError } from "./hosted-errors.js";

export interface SecureLoginStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

interface NativeEntry {
  getPassword(): string | null;
  setPassword(value: string): void;
  deleteCredential(): boolean;
}

type EntryConstructor = new (service: string, user: string) => NativeEntry;

/** Native keychain custody only; the caller validates the stored login schema. */
export class OperatingSystemLoginStore implements SecureLoginStore {
  constructor(
    private readonly service: string,
    private readonly user: string,
    private readonly loadEntry: () => Promise<EntryConstructor> = loadNativeEntry,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async read(): Promise<string | null> {
    try {
      const value = (await this.entry()).getPassword();
      if (value === null) return null;
      requireValue(value);
      return value;
    } catch {
      throw unavailable();
    }
  }

  async write(value: string): Promise<void> {
    try {
      requireValue(value);
      (await this.entry()).setPassword(value);
      // Reopen the fixed entry; a successful native write alone is not custody.
      if ((await this.read()) !== value) throw unavailable();
    } catch {
      throw unavailable();
    }
  }

  async remove(): Promise<void> {
    try {
      const deleted = (await this.entry()).deleteCredential();
      if (typeof deleted !== "boolean" || (await this.read()) !== null) {
        throw unavailable();
      }
    } catch {
      throw unavailable();
    }
  }

  private async entry(): Promise<NativeEntry> {
    // @napi-rs/keyring 2.0.0 silently changes Linux storage from Secret Service
    // to keyutils after initialization errors. That cannot preserve durable
    // login custody or distinguish a locked store from an absent credential.
    // Linux remains blocked until a fail-closed Secret Service adapter exists.
    if (
      !["darwin", "win32"].includes(this.platform) ||
      !this.service ||
      !this.user
    ) {
      throw unavailable();
    }
    const Entry = await this.loadEntry();
    return new Entry(this.service, this.user);
  }
}

export function createOperatingSystemLoginStore(): SecureLoginStore {
  return new OperatingSystemLoginStore("is.fonte.cli", "login-v1");
}

async function loadNativeEntry(): Promise<EntryConstructor> {
  // Dynamic import makes unavailable native bindings a sanitized command
  // failure, rather than an import failure that prints provider diagnostics.
  const { Entry } = await import("@napi-rs/keyring");
  return Entry;
}

function requireValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw unavailable();
  }
}

function unavailable(): HostedTestBlockedError {
  // Native errors can contain credential bytes. Do not preserve cause/message.
  return new HostedTestBlockedError("secure_storage_unavailable");
}
