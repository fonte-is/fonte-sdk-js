import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const CLIENT_AUTH_STORE_NATIVE_ABI =
  "fonte.client_auth_store.native.v1" as const;

export interface NativeClientAuthStore {
  readonly ABI_NAME: typeof CLIENT_AUTH_STORE_NATIVE_ABI;
  read(): Promise<Buffer | null>;
  replace(payload: Buffer, permitInteraction: boolean): Promise<void>;
}

export interface NativeLoaderTarget {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly libc?: "glibc" | "other";
}

export type NativeModuleLoader = (absolutePath: string) => unknown;

const PACKAGED_FILES = new Map<string, string>([
  ["darwin/arm64", "native/darwin-arm64/fonte_client_auth_store.node"],
  ["darwin/x64", "native/darwin-x64/fonte_client_auth_store.node"],
  ["win32/x64", "native/win32-x64/fonte_client_auth_store.node"],
  ["linux/x64/glibc", "native/linux-x64-gnu/fonte_client_auth_store.node"],
  ["linux/arm64/glibc", "native/linux-arm64-gnu/fonte_client_auth_store.node"],
]);

export async function loadNativeClientAuthStore(
  target: NativeLoaderTarget = runtimeTarget(),
  load: NativeModuleLoader = loadNativeModule,
): Promise<NativeClientAuthStore> {
  const key =
    target.platform === "linux"
      ? `${target.platform}/${target.arch}/${target.libc ?? "other"}`
      : `${target.platform}/${target.arch}`;
  const packagedFile = PACKAGED_FILES.get(key);
  if (!packagedFile) throw new Error("native_store_unavailable");

  const absolutePath = fileURLToPath(
    new URL(`../../${packagedFile}`, import.meta.url),
  );
  const candidate = moduleNamespace(load(absolutePath));
  if (
    candidate.ABI_NAME !== CLIENT_AUTH_STORE_NATIVE_ABI ||
    typeof candidate.read !== "function" ||
    typeof candidate.replace !== "function"
  ) {
    throw new Error("native_store_invalid");
  }
  return candidate as unknown as NativeClientAuthStore;
}

function runtimeTarget(): NativeLoaderTarget {
  return {
    platform: process.platform,
    arch: process.arch,
    libc: process.platform === "linux" ? runtimeLibc() : undefined,
  };
}

function runtimeLibc(): "glibc" | "other" {
  const report = process.report?.getReport() as
    { header?: { glibcVersionRuntime?: unknown } } | undefined;
  return typeof report?.header?.glibcVersionRuntime === "string"
    ? "glibc"
    : "other";
}

function loadNativeModule(absolutePath: string): unknown {
  return createRequire(import.meta.url)(absolutePath);
}

function moduleNamespace(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("native_store_invalid");
  const record = value as Record<string, unknown>;
  if (record.default && typeof record.default === "object") {
    return record.default as Record<string, unknown>;
  }
  return record;
}
