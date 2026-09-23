import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const maxConfigBytes = 1_048_576;
const localServerNames = new Set(["fonte", "fonte-local"]);

export interface LocalMcpHostCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface CodexMcpConfigPlan {
  readonly text: string;
  readonly changed: boolean;
  readonly removedServers: readonly string[];
}

export interface CodexMcpConfigStore {
  readText(): Promise<string>;
  writeText(expectedText: string, nextText: string): Promise<void>;
}

export interface CodexMcpConfigStoreOptions {
  readonly configPath?: string;
  readonly codexHome?: string;
  readonly home?: string;
}

/** Replaces only the two Fonte-owned Codex entries and preserves other text. */
export function reconcileCodexMcpConfig(
  source: string,
  host: LocalMcpHostCommand,
): CodexMcpConfigPlan {
  assertHostCommand(host);
  if (Buffer.byteLength(source, "utf8") > maxConfigBytes)
    throw new Error("codex_mcp_config_too_large");

  const lines = source.split("\n");
  const tableHeaders = scanTableHeaders(lines);
  const firstTableLine = tableHeaders[0]?.line ?? lines.length;
  if (hasTopLevelMcpAssignment(lines, firstTableLine))
    throw new Error("codex_mcp_config_unsupported_fonte_entry");
  const removed = new Set<number>();
  const removedServers = new Set<string>();
  const directFonteSections: number[] = [];
  let canonicalFonteTableCount = 0;
  let rootFonteEntryCount = 0;

  for (let index = 0; index < tableHeaders.length; index += 1) {
    const header = tableHeaders[index]!;
    if (header.path[0] === "mcp_servers" && header.path.length >= 2) {
      const server = header.path[1]!;
      if (!localServerNames.has(server)) continue;
      const end = tableHeaders[index + 1]?.line ?? lines.length;
      for (let line = header.line; line < end; line += 1) removed.add(line);
      removedServers.add(server);
      if (server === "fonte" && header.path.length === 2 && !header.array) {
        directFonteSections.push(header.line);
        canonicalFonteTableCount += 1;
      }
    }

    if (header.path.length !== 1 || header.path[0] !== "mcp_servers") continue;
    const end = tableHeaders[index + 1]?.line ?? lines.length;
    for (const line of rootServerAssignmentLines(lines, header.line + 1, end)) {
      const assignment = parseRootServerAssignment(withoutCr(lines[line]!));
      if (!assignment) continue;
      if (!localServerNames.has(assignment.name)) continue;
      if (!assignment.inlineTable)
        throw new Error("codex_mcp_config_unsupported_fonte_entry");
      removed.add(line);
      removedServers.add(assignment.name);
      rootFonteEntryCount += 1;
    }
  }

  const canonical = canonicalEntry(host);
  const existingCanonical =
    canonicalFonteTableCount === 1 &&
    removedServers.size === 1 &&
    rootFonteEntryCount === 0 &&
    removedServers.has("fonte") &&
    sectionText(lines, directFonteSections[0]!, tableHeaders).replaceAll(
      "\r",
      "",
    ) === canonical.trim();
  if (existingCanonical)
    return { text: source, changed: false, removedServers: [] };

  const retained = lines.filter((_line, index) => !removed.has(index));
  let text = retained.join("\n");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (text.length > 0 && !text.endsWith("\n")) text += newline;
  if (text.length > 0 && !text.endsWith(`${newline}${newline}`))
    text += newline;
  text += canonical.replaceAll("\n", newline) + newline;
  if (Buffer.byteLength(text, "utf8") > maxConfigBytes)
    throw new Error("codex_mcp_config_too_large");
  return {
    text,
    changed: text !== source,
    removedServers: [...removedServers],
  };
}

export function canonicalCodexMcpConfigPath(
  options: CodexMcpConfigStoreOptions = {},
): string {
  if (options.configPath !== undefined) {
    if (!path.isAbsolute(options.configPath))
      throw new Error("codex_mcp_config_path_invalid");
    return path.resolve(options.configPath);
  }
  const root =
    options.codexHome ??
    process.env.CODEX_HOME ??
    path.join(options.home ?? homedir(), ".codex");
  if (!path.isAbsolute(root)) throw new Error("codex_mcp_config_path_invalid");
  return path.join(path.resolve(root), "config.toml");
}

/** File-backed adapter. Callers pass the expected text to prevent lost updates. */
export function createCodexMcpConfigStore(
  options: CodexMcpConfigStoreOptions = {},
): CodexMcpConfigStore {
  const configPath = canonicalCodexMcpConfigPath(options);
  return {
    async readText() {
      let before;
      try {
        before = await lstat(configPath, { bigint: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw new Error("codex_mcp_config_unavailable");
      }
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        before.size > BigInt(maxConfigBytes)
      )
        throw new Error("codex_mcp_config_unavailable");
      let handle;
      try {
        handle = await open(
          configPath,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        const opened = await handle.stat({ bigint: true });
        if (!sameFile(before, opened) || opened.size > BigInt(maxConfigBytes))
          throw new Error("codex_mcp_config_unavailable");
        const text = await handle.readFile({ encoding: "utf8" });
        const after = await handle.stat({ bigint: true });
        const current = await lstat(configPath, { bigint: true });
        if (!sameFile(opened, after) || !sameFile(after, current))
          throw new Error("codex_mcp_config_changed");
        return text;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        if (
          error instanceof Error &&
          error.message.startsWith("codex_mcp_config_")
        )
          throw error;
        throw new Error("codex_mcp_config_unavailable");
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
    async writeText(expectedText, nextText) {
      if (Buffer.byteLength(nextText, "utf8") > maxConfigBytes)
        throw new Error("codex_mcp_config_too_large");
      const current = await this.readText();
      if (current !== expectedText) throw new Error("codex_mcp_config_changed");
      const directory = path.dirname(configPath);
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const before = await lstat(configPath, { bigint: true }).catch(
          (error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          },
        );
        if (before && (before.isSymbolicLink() || !before.isFile()))
          throw new Error("codex_mcp_config_unavailable");
        const mode = before ? Number(before.mode & 0o777n) : 0o600;
        const temporary = `${configPath}.fonte-${process.pid}-${randomUUID()}`;
        let handle;
        try {
          handle = await open(
            temporary,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
            mode,
          );
          if (process.platform !== "win32") await handle.chmod(mode);
          await handle.writeFile(nextText, "utf8");
          await handle.sync();
          await handle.close();
          handle = undefined;
          const currentAgain = await this.readText();
          if (currentAgain !== expectedText)
            throw new Error("codex_mcp_config_changed");
          await rename(temporary, configPath);
          const directoryHandle = await open(
            directory,
            constants.O_RDONLY,
          ).catch(() => undefined);
          await directoryHandle?.sync().catch(() => undefined);
          await directoryHandle?.close().catch(() => undefined);
        } finally {
          await handle?.close().catch(() => undefined);
          await unlink(temporary).catch(() => undefined);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("codex_mcp_config_")
        )
          throw error;
        throw new Error("codex_mcp_config_unavailable");
      }
    },
  };
}

function canonicalEntry(host: LocalMcpHostCommand): string {
  return [
    "[mcp_servers.fonte]",
    `command = ${JSON.stringify(host.command)}`,
    `args = [${host.args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
  ].join("\n");
}

function assertHostCommand(host: LocalMcpHostCommand): void {
  if (
    !path.isAbsolute(host.command) ||
    host.args.length !== 1 ||
    !path.isAbsolute(host.args[0]!) ||
    [host.command, ...host.args].some((value) =>
      /[\u0000-\u001f\u007f]/.test(value),
    )
  )
    throw new Error("local_mcp_host_invalid");
}

interface TableHeader {
  readonly line: number;
  readonly path: readonly string[];
  readonly array: boolean;
}

function scanTableHeaders(lines: readonly string[]): TableHeader[] {
  const result: TableHeader[] = [];
  let multiline: "basic" | "literal" | null = null;
  for (let line = 0; line < lines.length; line += 1) {
    const value = withoutCr(lines[line]!);
    if (multiline === null) {
      const header = parseTableHeader(value);
      if (header) result.push({ ...header, line });
    }
    multiline = updateMultilineState(value, multiline);
  }
  return result;
}

function hasTopLevelMcpAssignment(
  lines: readonly string[],
  end: number,
): boolean {
  let multiline: "basic" | "literal" | null = null;
  for (let index = 0; index < end; index += 1) {
    const line = withoutCr(lines[index]!);
    if (multiline === null && /^\s*mcp_servers\s*=/.test(line)) return true;
    multiline = updateMultilineState(line, multiline);
  }
  return false;
}

function rootServerAssignmentLines(
  lines: readonly string[],
  start: number,
  end: number,
): number[] {
  const matches: number[] = [];
  let multiline: "basic" | "literal" | null = null;
  for (let index = start; index < end; index += 1) {
    const line = withoutCr(lines[index]!);
    if (multiline === null && parseRootServerAssignment(line))
      matches.push(index);
    multiline = updateMultilineState(line, multiline);
  }
  return matches;
}

function parseTableHeader(
  line: string,
): Pick<TableHeader, "path" | "array"> | null {
  const trimmed = line.trimStart();
  const array = trimmed.startsWith("[[");
  const open = array ? "[[" : "[";
  const close = array ? "]]" : "]";
  if (!trimmed.startsWith(open)) return null;
  const closeIndex = findHeaderClose(trimmed, open.length, close);
  if (
    closeIndex < 0 ||
    !/^(?:\s*#.*)?$/.test(trimmed.slice(closeIndex + close.length))
  )
    return null;
  const pathText = trimmed.slice(open.length, closeIndex).trim();
  const keys = parseTomlKeyPath(pathText);
  return keys ? { path: keys, array } : null;
}

function findHeaderClose(source: string, from: number, close: string): number {
  let quote: "basic" | "literal" | null = null;
  for (let index = from; index < source.length; index += 1) {
    if (quote === "basic") {
      if (source[index] === "\\") index += 1;
      else if (source[index] === '"') quote = null;
      continue;
    }
    if (quote === "literal") {
      if (source[index] === "'") quote = null;
      continue;
    }
    if (source[index] === '"') quote = "basic";
    else if (source[index] === "'") quote = "literal";
    else if (source.startsWith(close, index)) return index;
  }
  return -1;
}

function parseTomlKeyPath(value: string): string[] | null {
  const keys: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) index += 1;
    const quote =
      value[index] === '"' || value[index] === "'" ? value[index] : null;
    if (quote) {
      index += 1;
      let key = "";
      let closed = false;
      while (index < value.length) {
        const char = value[index]!;
        if (quote === '"' && char === "\\") {
          if (index + 1 >= value.length) return null;
          key += value[index + 1]!;
          index += 2;
          continue;
        }
        if (char === quote) {
          closed = true;
          index += 1;
          break;
        }
        key += char;
        index += 1;
      }
      if (!closed) return null;
      keys.push(key);
    } else {
      const start = index;
      while (/[A-Za-z0-9_-]/.test(value[index] ?? "")) index += 1;
      if (start === index) return null;
      keys.push(value.slice(start, index));
    }
    while (/\s/.test(value[index] ?? "")) index += 1;
    if (index === value.length) break;
    if (value[index] !== ".") return null;
    index += 1;
  }
  return keys.length ? keys : null;
}

function parseRootServerAssignment(
  line: string,
): { readonly name: string; readonly inlineTable: boolean } | null {
  const match = line.match(
    /^\s*(?:fonte|"fonte"|'fonte'|fonte-local|"fonte-local"|'fonte-local')\s*=\s*(.*?)\s*(?:#.*)?$/,
  );
  if (!match) return null;
  const nameMatch = line.match(
    /^\s*(fonte-local|fonte|"fonte-local"|'fonte-local'|"fonte"|'fonte')/,
  );
  const key = nameMatch?.[1]?.replaceAll('"', "").replaceAll("'", "");
  return key
    ? {
        name: key,
        inlineTable: match[1]!.startsWith("{") && match[1]!.endsWith("}"),
      }
    : null;
}

function sectionText(
  lines: readonly string[],
  start: number,
  headers: readonly TableHeader[],
): string {
  const end =
    headers.find((header) => header.line > start)?.line ?? lines.length;
  return lines.slice(start, end).join("\n").trim();
}

function updateMultilineState(
  line: string,
  initial: "basic" | "literal" | null,
): "basic" | "literal" | null {
  let state = initial;
  for (let index = 0; index < line.length;) {
    if (state === "basic") {
      const end = findUnescaped(line, '"""', index);
      if (end < 0) return state;
      state = null;
      index = end + 3;
      continue;
    }
    if (state === "literal") {
      const end = line.indexOf("'''", index);
      if (end < 0) return state;
      state = null;
      index = end + 3;
      continue;
    }
    if (line[index] === "#") return null;
    if (line.startsWith('"""', index)) {
      state = "basic";
      index += 3;
      continue;
    }
    if (line.startsWith("'''", index)) {
      state = "literal";
      index += 3;
      continue;
    }
    const quote = line[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      while (index < line.length) {
        if (quote === '"' && line[index] === "\\") {
          index += 2;
          continue;
        }
        if (line[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return state;
}

function findUnescaped(source: string, marker: string, from: number): number {
  for (let index = from; index <= source.length - marker.length; index += 1) {
    if (!source.startsWith(marker, index)) continue;
    let slashCount = 0;
    for (let back = index - 1; back >= 0 && source[back] === "\\"; back -= 1)
      slashCount += 1;
    if (slashCount % 2 === 0) return index;
  }
  return -1;
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function withoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
