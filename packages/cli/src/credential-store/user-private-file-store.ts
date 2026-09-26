import { execFile as execFileCallback } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

import { canonicalJson } from "../canonical-json.js";
import type {
  ClientAuthStore,
  ClientSessionRecord,
} from "../client-auth-types.js";
import { HostedTestBlockedError } from "../hosted-errors.js";
import { parseSessionRecord } from "../persistent-login-record.js";

const execFile = promisify(execFileCallback);
const SESSION_FILE = "session.v1.json";
export const USER_PRIVATE_SESSION_LIMIT_BYTES = 2_400;

export type FileStoreFailureKind = "unavailable" | "misconfigured";

export class UserPrivateStoreFailure extends Error {
  readonly code: string;

  constructor(readonly kind: FileStoreFailureKind) {
    super(`fonte_file_store_${kind}`);
    this.name = "UserPrivateStoreFailure";
    this.code = `fonte_file_store_${kind}`;
  }
}

export interface WindowsFileAcl {
  secureDirectory(directory: string): Promise<void>;
  assertDirectory(directory: string): Promise<void>;
  secureFile(file: string): Promise<void>;
  assertFile(file: string): Promise<void>;
}

export interface UserPrivateFileStoreOptions {
  readonly directory?: string;
  readonly platform?: NodeJS.Platform;
  readonly expectedUid?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly windowsAcl?: WindowsFileAcl;
}

/** A durable, per-user session store for native-store-unavailable contexts. */
export class UserPrivateFileAuthStore implements ClientAuthStore {
  readonly #directory: string;
  readonly #sessionPath: string;
  readonly #platform: NodeJS.Platform;
  readonly #expectedUid: number | undefined;
  readonly #windowsAcl: WindowsFileAcl;

  constructor(options: UserPrivateFileStoreOptions = {}) {
    this.#directory = path.resolve(
      options.directory ?? userDataDirectory(options),
    );
    this.#sessionPath = path.join(this.#directory, SESSION_FILE);
    this.#platform = options.platform ?? process.platform;
    this.#expectedUid = options.expectedUid ?? process.getuid?.();
    this.#windowsAcl =
      options.windowsAcl ?? new PowerShellCurrentUserAcl(this.#platform);
  }

  async read({ signal }: { allowInteraction: false; signal?: AbortSignal }) {
    active(signal);
    const payload = await readPrivateFile(
      this.#directory,
      this.#sessionPath,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
    active(signal);
    if (payload === null) return null;
    return decodeRecord(payload);
  }

  async replace(
    record: ClientSessionRecord,
    { signal }: { allowInteraction: boolean; signal?: AbortSignal },
  ) {
    active(signal);
    const payload = encodeRecord(record);
    await writePrivateFile(
      this.#directory,
      this.#sessionPath,
      payload,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
    active(signal);
  }

  /** Remove only Fonte's selected session file after logout has fenced it. */
  async clearSession() {
    await clearPrivateFile(
      this.#directory,
      this.#sessionPath,
      this.#platform,
      this.#expectedUid,
      this.#windowsAcl,
    );
  }
}

export function userDataDirectory(
  options: Pick<UserPrivateFileStoreOptions, "platform" | "env" | "home"> = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  if (!path.isAbsolute(home)) throw failure("misconfigured");
  if (platform === "darwin")
    return path.join(home, "Library", "Application Support", "Fonte", "CLI");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    const base =
      local && path.isAbsolute(local)
        ? local
        : path.join(home, "AppData", "Local");
    return path.join(base, "Fonte", "CLI");
  }
  const xdg = env.XDG_DATA_HOME;
  const base =
    xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".local", "share");
  return path.join(base, "fonte", "cli");
}

export function sessionFilePath(directory: string): string {
  return path.join(path.resolve(directory), SESSION_FILE);
}

export async function readPrivateConfigFile(
  directory: string,
  fileName: string,
  platform = process.platform,
  expectedUid = process.getuid?.(),
  windowsAcl: WindowsFileAcl = new PowerShellCurrentUserAcl(platform),
): Promise<Buffer | null> {
  const file = path.join(path.resolve(directory), fileName);
  return readPrivateFile(directory, file, platform, expectedUid, windowsAcl);
}

export async function writePrivateConfigFile(
  directory: string,
  fileName: string,
  payload: Uint8Array,
  platform = process.platform,
  expectedUid = process.getuid?.(),
  windowsAcl: WindowsFileAcl = new PowerShellCurrentUserAcl(platform),
): Promise<void> {
  const file = path.join(path.resolve(directory), fileName);
  await writePrivateFile(
    directory,
    file,
    payload,
    platform,
    expectedUid,
    windowsAcl,
  );
}

async function readPrivateFile(
  directory: string,
  file: string,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
  windowsAcl: WindowsFileAcl,
): Promise<Buffer | null> {
  const directoryExists = await assertPrivateDirectory(
    directory,
    false,
    platform,
    expectedUid,
    windowsAcl,
  );
  if (!directoryExists) return null;
  let before = await lstatMaybe(file);
  if (!before) return null;
  assertPrivateFileMetadata(before, platform, expectedUid);
  if (platform === "win32") await windowsAcl.assertFile(file);

  let handle;
  try {
    const noFollow = platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    handle = await open(file, constants.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    assertPrivateFileMetadata(opened, platform, expectedUid);
    if (!sameIdentity(before, opened)) throw failure("misconfigured");
    if (opened.size > BigInt(USER_PRIVATE_SESSION_LIMIT_BYTES))
      throw failure("misconfigured");

    const bytes = Buffer.alloc(USER_PRIVATE_SESSION_LIMIT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    assertPrivateFileMetadata(after, platform, expectedUid);
    if (
      !sameIdentity(opened, after) ||
      after.size > BigInt(USER_PRIVATE_SESSION_LIMIT_BYTES)
    )
      throw failure("misconfigured");
    if (length > USER_PRIVATE_SESSION_LIMIT_BYTES)
      throw failure("misconfigured");
    before = await lstatMaybe(file);
    if (!before || !sameIdentity(after, before)) throw failure("misconfigured");
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof UserPrivateStoreFailure) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP" || code === "EACCES" || code === "EPERM")
      throw failure("misconfigured");
    throw failure("unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writePrivateFile(
  directory: string,
  file: string,
  payload: Uint8Array,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
  windowsAcl: WindowsFileAcl,
): Promise<void> {
  if (payload.byteLength > USER_PRIVATE_SESSION_LIMIT_BYTES)
    throw failure("misconfigured");
  await assertPrivateDirectory(
    directory,
    true,
    platform,
    expectedUid,
    windowsAcl,
  );
  const existing = await lstatMaybe(file);
  if (existing) {
    assertPrivateFileMetadata(existing, platform, expectedUid);
    if (platform === "win32") await windowsAcl.assertFile(file);
  }

  const temporary = `${file}.fonte-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    const noFollow = platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    if (platform !== "win32") await handle.chmod(0o600);
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (platform === "win32") await windowsAcl.secureFile(temporary);
    else
      assertPrivateFileMetadata(
        await lstat(temporary, { bigint: true }),
        platform,
        expectedUid,
      );

    await assertPrivateDirectory(
      directory,
      false,
      platform,
      expectedUid,
      windowsAcl,
    );
    const current = await lstatMaybe(file);
    if (current) {
      assertPrivateFileMetadata(current, platform, expectedUid);
      if (platform === "win32") await windowsAcl.assertFile(file);
    }
    await rename(temporary, file);
    await syncDirectory(directory, platform);

    const readback = await readPrivateFile(
      directory,
      file,
      platform,
      expectedUid,
      windowsAcl,
    );
    if (!readback || !Buffer.from(payload).equals(readback))
      throw failure("unavailable");
  } catch (error) {
    if (error instanceof UserPrivateStoreFailure) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP" || code === "EACCES" || code === "EPERM")
      throw failure("misconfigured");
    throw failure("unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function clearPrivateFile(
  directory: string,
  file: string,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
  windowsAcl: WindowsFileAcl,
): Promise<void> {
  if (
    !(await assertPrivateDirectory(
      directory,
      false,
      platform,
      expectedUid,
      windowsAcl,
    ))
  )
    return;
  const existing = await lstatMaybe(file);
  if (!existing) return;
  assertPrivateFileMetadata(existing, platform, expectedUid);
  if (platform === "win32") await windowsAcl.assertFile(file);
  try {
    await unlink(file);
    await syncDirectory(directory, platform);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    if (error instanceof UserPrivateStoreFailure) throw error;
    throw failure("unavailable");
  }
}

async function assertPrivateDirectory(
  directory: string,
  create: boolean,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
  windowsAcl: WindowsFileAcl,
): Promise<boolean> {
  let existing = await lstatMaybe(directory);
  if (!existing) {
    if (!create) return false;
    await assertNoSymlinkComponents(directory);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (platform !== "win32") await chmod(directory, 0o700);
      else await windowsAcl.secureDirectory(directory);
    } catch {
      throw failure("unavailable");
    }
    existing = await lstatMaybe(directory);
    if (!existing) throw failure("unavailable");
  }
  if (existing.isSymbolicLink() || !existing.isDirectory())
    throw failure("misconfigured");
  await assertNoSymlinkComponents(directory);
  assertPrivateDirectoryMetadata(existing, platform, expectedUid);
  if (platform === "win32") await windowsAcl.assertDirectory(directory);
  return true;
}

async function assertNoSymlinkComponents(target: string) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstatMaybe(current);
    if (stat?.isSymbolicLink()) throw failure("misconfigured");
  }
}

function assertPrivateDirectoryMetadata(
  stat: BigIntStats,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
) {
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw failure("misconfigured");
  if (platform === "win32") return;
  if (expectedUid !== undefined && stat.uid !== BigInt(expectedUid))
    throw failure("misconfigured");
  if ((stat.mode & 0o7777n) !== 0o700n) throw failure("misconfigured");
}

function assertPrivateFileMetadata(
  stat: BigIntStats,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
) {
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n)
    throw failure("misconfigured");
  if (platform === "win32") return;
  if (expectedUid !== undefined && stat.uid !== BigInt(expectedUid))
    throw failure("misconfigured");
  if ((stat.mode & 0o7777n) !== 0o600n) throw failure("misconfigured");
}

function sameIdentity(
  left: { dev: bigint; ino: bigint },
  right: { dev: bigint; ino: bigint },
) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function lstatMaybe(target: string) {
  try {
    return await lstat(target, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    if (
      ["ELOOP", "EACCES", "EPERM"].includes(
        (error as NodeJS.ErrnoException)?.code ?? "",
      )
    )
      throw failure("misconfigured");
    throw failure("unavailable");
  }
}

async function syncDirectory(directory: string, platform: NodeJS.Platform) {
  if (platform === "win32") return;
  let handle;
  try {
    const directoryFlag = constants.O_DIRECTORY ?? 0;
    handle = await open(directory, constants.O_RDONLY | directoryFlag);
    await handle.sync();
  } catch {
    throw failure("unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function encodeRecord(record: ClientSessionRecord): Buffer {
  const validated = parseSessionRecord(record);
  const payload = Buffer.from(canonicalJson(validated), "utf8");
  if (payload.byteLength > USER_PRIVATE_SESSION_LIMIT_BYTES)
    throw failure("misconfigured");
  return payload;
}

function decodeRecord(payload: Buffer): ClientSessionRecord {
  if (payload.byteLength > USER_PRIVATE_SESSION_LIMIT_BYTES)
    throw failure("misconfigured");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw failure("misconfigured");
  }
  const record = parseSessionRecord(text);
  if (!Buffer.from(canonicalJson(record), "utf8").equals(payload))
    throw failure("misconfigured");
  return record;
}

function active(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new HostedTestBlockedError("authorization_cancelled");
}

function failure(kind: FileStoreFailureKind): UserPrivateStoreFailure {
  return new UserPrivateStoreFailure(kind);
}

class PowerShellCurrentUserAcl implements WindowsFileAcl {
  constructor(private readonly platform: NodeJS.Platform) {}

  async secureDirectory(directory: string) {
    await this.run(setAclScript(directory, true));
    await this.assertDirectory(directory);
  }

  async assertDirectory(directory: string) {
    await this.run(assertAclScript(directory, true));
  }

  async secureFile(file: string) {
    await this.run(setAclScript(file, false));
    await this.assertFile(file);
  }

  async assertFile(file: string) {
    await this.run(assertAclScript(file, false));
  }

  private async run(script: string) {
    if (this.platform !== "win32") return;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    try {
      await execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          encoded,
        ],
        { windowsHide: true, timeout: 5_000, maxBuffer: 4_096 },
      );
    } catch {
      throw failure("misconfigured");
    }
  }
}

function setAclScript(target: string, directory: boolean) {
  const pathLiteral = powershellLiteral(target);
  const inheritance = directory
    ? "[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit"
    : "[System.Security.AccessControl.InheritanceFlags]::None";
  return `$ErrorActionPreference='Stop'; $p=${pathLiteral}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; $acl.SetAccessRuleProtection($true,$false); foreach($old in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($old)}; $acl.SetOwner($sid); $inherit=${inheritance}; $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.SetAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl`;
}

function assertAclScript(target: string, directory: boolean) {
  const pathLiteral = powershellLiteral(target);
  const expectedInheritance = directory
    ? "ContainerInherit, ObjectInherit"
    : "None";
  return `$ErrorActionPreference='Stop'; $p=${pathLiteral}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; $owner=(New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value; if($owner -ne $sid.Value -or -not $acl.AreAccessRulesProtected){exit 21}; $rules=@($acl.Access); if($rules.Count -ne 1){exit 22}; $rule=$rules[0]; $ruleSid=$rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($ruleSid -ne $sid.Value -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $rule.FileSystemRights.ToString() -ne 'FullControl' -or $rule.InheritanceFlags.ToString() -ne '${expectedInheritance}'){exit 23}`;
}

function powershellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
