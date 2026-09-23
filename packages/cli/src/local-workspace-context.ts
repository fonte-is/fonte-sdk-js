import {
  readPrivateConfigFile,
  userDataDirectory,
  writePrivateConfigFile,
  type UserPrivateFileStoreOptions,
} from "./credential-store/user-private-file-store.js";

const WORKSPACE_CONTEXT_FILE = "workspace-context.v1.json";
const WORKSPACE_CONTEXT_SCHEMA = "fonte.local_workspace_context.v1";

export interface LocalWorkspaceContextStoreOptions extends UserPrivateFileStoreOptions {
  readonly directory?: string;
}

/** Stores only the user's local workspace preference beside the existing session. */
export class LocalWorkspaceContextStore {
  readonly #directory: string;
  readonly #platform: NodeJS.Platform;
  readonly #expectedUid: number | undefined;
  readonly #windowsAcl?: UserPrivateFileStoreOptions["windowsAcl"];

  constructor(options: LocalWorkspaceContextStoreOptions = {}) {
    this.#directory = options.directory ?? userDataDirectory(options);
    this.#platform = options.platform ?? process.platform;
    this.#expectedUid = options.expectedUid ?? process.getuid?.();
    this.#windowsAcl = options.windowsAcl;
  }

  async read(): Promise<string | null> {
    const bytes = await readPrivateConfigFile(
      this.#directory,
      WORKSPACE_CONTEXT_FILE,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
    if (bytes === null) return null;
    try {
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "schema,workspace_slug" ||
        (value as { schema?: unknown }).schema !== WORKSPACE_CONTEXT_SCHEMA ||
        !validWorkspaceSlug(
          (value as { workspace_slug?: unknown }).workspace_slug,
        )
      )
        throw new Error("local_workspace_context_invalid");
      return (value as { workspace_slug: string }).workspace_slug;
    } catch {
      throw new Error("local_workspace_context_unavailable");
    }
  }

  async select(slug: string): Promise<void> {
    if (!validWorkspaceSlug(slug))
      throw new Error("local_workspace_context_invalid");
    const payload = Buffer.from(
      `${JSON.stringify({
        schema: WORKSPACE_CONTEXT_SCHEMA,
        workspace_slug: slug,
      })}\n`,
      "utf8",
    );
    await writePrivateConfigFile(
      this.#directory,
      WORKSPACE_CONTEXT_FILE,
      payload,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
    const readback = await readPrivateConfigFile(
      this.#directory,
      WORKSPACE_CONTEXT_FILE,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
    if (!readback || !payload.equals(readback))
      throw new Error("local_workspace_context_unavailable");
  }
}

export function validWorkspaceSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 63 &&
    /^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  );
}
