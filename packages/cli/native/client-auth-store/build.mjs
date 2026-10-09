import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const offline = process.argv.slice(2);
if (offline.length && (offline.length !== 1 || offline[0] !== "--offline")) {
  throw new Error("Usage: node build.mjs [--offline]");
}
if (process.env.RUSTFLAGS?.trim()) {
  throw new Error(
    "Use CARGO_ENCODED_RUSTFLAGS for custom native compiler flags.",
  );
}
const crate = path.dirname(fileURLToPath(import.meta.url));
const target = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
  /^host: (.+)$/m,
)?.[1];
const destinations = new Map([
  [
    "aarch64-apple-darwin",
    ["darwin-arm64", "libfonte_client_auth_store.dylib"],
  ],
  ["x86_64-apple-darwin", ["darwin-x64", "libfonte_client_auth_store.dylib"]],
  ["x86_64-pc-windows-msvc", ["win32-x64", "fonte_client_auth_store.dll"]],
  [
    "x86_64-unknown-linux-gnu",
    ["linux-x64-gnu", "libfonte_client_auth_store.so"],
  ],
  [
    "aarch64-unknown-linux-gnu",
    ["linux-arm64-gnu", "libfonte_client_auth_store.so"],
  ],
]);
const destination = destinations.get(target);
if (!destination)
  throw new Error("The native helper does not support this host.");
const targetDirectory = path.resolve(
  process.env.CARGO_TARGET_DIR ??
    path.join(tmpdir(), "fonte-native-build", target),
);
const prefixes = [
  [homedir(), "/build-user"],
  [
    path.resolve(process.env.CARGO_HOME ?? path.join(homedir(), ".cargo")),
    "/cargo",
  ],
  [
    path.resolve(process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup")),
    "/rustup",
  ],
  [crate, "/fonte-native/source"],
  [targetDirectory, "/fonte-native/target"],
];
const inherited = process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ?? [];
execFileSync(
  "cargo",
  ["build", "--release", "--locked", "--target", target, ...offline],
  {
    cwd: crate,
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDirectory,
      CARGO_ENCODED_RUSTFLAGS: [
        ...inherited,
        ...prefixes.map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
      ].join("\x1f"),
    },
  },
);
const packaged = path.join(crate, "..", destination[0]);
mkdirSync(packaged, { recursive: true });
copyFileSync(
  path.join(targetDirectory, target, "release", destination[1]),
  path.join(packaged, "fonte_client_auth_store.node"),
);
