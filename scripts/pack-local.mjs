import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { packageOrder } from "./workspace-utils.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageNames = packageOrder;
const packsDirectory = path.join(root, ".artifacts", "packs");
const workspaceLock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);

await rm(packsDirectory, { recursive: true, force: true });
await mkdir(packsDirectory, { recursive: true });

const runJson = (args, cwd) => {
  const stdout = execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(stdout);
};

const exportTargets = (value) => {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.values(value).flatMap(exportTargets);
};

const results = [];
for (const packageDirectoryName of packageNames) {
  const packageDirectory = path.join(root, "packages", packageDirectoryName);
  const manifestPath = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const lockedVersion =
    workspaceLock.packages?.[`packages/${packageDirectoryName}`]?.version;
  if (typeof lockedVersion !== "string" || manifest.version !== lockedVersion) {
    throw new Error(
      `${manifest.name} package version does not match its workspace lock entry`,
    );
  }

  const dryRunResult = runJson(
    ["pack", "--dry-run", "--json"],
    packageDirectory,
  )[0];
  const packedFiles = new Set(
    dryRunResult.files.map(({ path: filePath }) => filePath),
  );

  for (const target of new Set(exportTargets(manifest.exports))) {
    if (!target.startsWith("./")) {
      throw new Error(
        `${manifest.name} export target must be package-relative: ${target}`,
      );
    }
    const relativeTarget = target.slice(2);
    const targetPath = path.join(packageDirectory, relativeTarget);
    const targetStat = await stat(targetPath).catch(() => null);
    if (!targetStat?.isFile()) {
      throw new Error(`${manifest.name} export target is missing: ${target}`);
    }
    if (!packedFiles.has(relativeTarget)) {
      throw new Error(
        `${manifest.name} export target is absent from dry-run pack: ${target}`,
      );
    }
  }

  for (const filePath of packedFiles) {
    if (filePath.startsWith("src/")) {
      throw new Error(
        `${manifest.name} leaked source into its package: ${filePath}`,
      );
    }
  }

  const packResult = runJson(
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packsDirectory,
    ],
    packageDirectory,
  )[0];
  const tarballPath = path.join(packsDirectory, packResult.filename);
  const tarball = await readFile(tarballPath);
  const archiveFiles = execFileSync("tar", ["-tzf", tarballPath], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""));

  for (const filePath of packedFiles) {
    if (!archiveFiles.includes(filePath)) {
      throw new Error(
        `${manifest.name} dry-run file missing from tarball: ${filePath}`,
      );
    }
  }

  const packedManifest = JSON.parse(
    execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  if (
    packedManifest.name !== manifest.name ||
    packedManifest.version !== manifest.version ||
    JSON.stringify(packedManifest.exports) !== JSON.stringify(manifest.exports)
  ) {
    throw new Error(
      `${manifest.name} packed manifest diverged from source manifest`,
    );
  }

  results.push({
    name: manifest.name,
    version: manifest.version,
    filename: packResult.filename,
    bytes: tarball.byteLength,
    sha256: createHash("sha256").update(tarball).digest("hex"),
    files: [...packedFiles].sort(),
  });
}

const manifestPath = path.join(packsDirectory, "pack-manifest.json");
const reportPath = path.join(packsDirectory, "pack-report.json");
await writeFile(manifestPath, `${JSON.stringify(results, null, 2)}\n`);
await writeFile(
  reportPath,
  `${JSON.stringify({ ok: true, published: false, packages: results }, null, 2)}\n`,
);

for (const result of results) {
  console.log(
    `${result.name}@${result.version} -> ${result.filename} (${result.bytes} bytes, sha256 ${result.sha256})`,
  );
}
console.log(`pack manifest: ${path.relative(root, manifestPath)}`);
console.log(`pack report: ${path.relative(root, reportPath)}`);
