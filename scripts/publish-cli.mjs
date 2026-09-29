import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectory = path.join(root, "packages", "cli");
const packageName = "@fonte-is/cli";
const packageVersion = "0.3.5";
const registryUrl = "https://registry.npmjs.org/";
const reviewedPackageRef = "2df2a856d6341757c08ffff27b9bc8c7f4aae4b1";
const reviewedSourceTree = "370010b616e795a4bdea460c3cb3f78a6b72814f";
const reviewedCliTree = "66f9b0c6322431fb2db0c18d00f9e3d5c46bb256";
const reviewedPackageLockBlob = "d9daaf65ca0529afe7a368208a14ac78afe58574";
const reviewedManifestBlob = "d3f591353d6a34d6c2c667bba29c8908d7504387";
const reviewedTarballDigests = {
  sha1: "0047ee236f5c6935da438628caeff79f67efd462",
  sha256: "7ef47a590ec2aa3f898cff916a8ffbe2bbe8b124d82e12446775384aa39868dd",
  integrity:
    "sha512-Vcvy2y3uXe0+ucvdwrBs9jIfnZqO5uNDX60WIi1dycZbV8Oja4s/ZaKQDjishZ7oF/MOIFW8NrzYnZBbumwphQ==",
};

const options = parseArguments(process.argv.slice(2));
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "fonte-cli-release-"),
);

try {
  const head = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  if (head !== options.expectedRef || tree !== options.expectedTree) {
    throw new Error(
      "checked-out ref/tree does not match the admitted release input",
    );
  }
  if (git(["status", "--porcelain"]) !== "") {
    throw new Error("release worktree must be clean");
  }
  if (
    git(["rev-parse", `${reviewedPackageRef}^{tree}`]) !== reviewedSourceTree ||
    git(["rev-parse", `${reviewedPackageRef}:packages/cli`]) !==
      reviewedCliTree ||
    git(["rev-parse", `${reviewedPackageRef}:package-lock.json`]) !==
      reviewedPackageLockBlob ||
    git(["rev-parse", `${reviewedPackageRef}:packages/cli/package.json`]) !==
      reviewedManifestBlob
  ) {
    throw new Error("reviewed CLI source identity is not exact");
  }
  run("git", [
    "diff",
    "--quiet",
    reviewedPackageRef,
    "--",
    "package-lock.json",
    "packages/cli",
  ]);

  const manifest = JSON.parse(
    await readFile(path.join(packageDirectory, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    await readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const lockedVersion = lock.packages?.["packages/cli"]?.version;
  if (manifest.name !== packageName || manifest.version !== packageVersion) {
    throw new Error(
      "CLI manifest does not match the reviewed package identity",
    );
  }
  if (lockedVersion !== packageVersion) {
    throw new Error("CLI workspace lock does not match the reviewed version");
  }

  const packResult = JSON.parse(
    run(
      "npm",
      ["pack", "--json", "--pack-destination", temporaryDirectory],
      packageDirectory,
    ),
  )[0];
  if (
    packResult.name !== packageName ||
    packResult.version !== packageVersion
  ) {
    throw new Error("npm pack selected an unexpected package identity");
  }

  const tarballPath = path.join(temporaryDirectory, packResult.filename);
  const tarball = await readFile(tarballPath);
  const digests = {
    sha1: createHash("sha1").update(tarball).digest("hex"),
    sha256: createHash("sha256").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  };
  if (
    digests.sha1 !== reviewedTarballDigests.sha1 ||
    digests.sha256 !== reviewedTarballDigests.sha256 ||
    digests.integrity !== reviewedTarballDigests.integrity
  ) {
    throw new Error("packed CLI bytes do not match the reviewed tarball");
  }

  const packedManifest = JSON.parse(
    run("tar", ["-xOzf", tarballPath, "package/package.json"]),
  );
  if (
    packedManifest.name !== packageName ||
    packedManifest.version !== packageVersion ||
    packedManifest.bin?.fonte !== "./dist/main.js"
  ) {
    throw new Error("packed CLI identity or binary entrypoint is invalid");
  }

  const artifactVerification = await verifyPackedArtifact(tarballPath);
  let outcome = "dry_run_ready";
  let registry = null;
  let publishInvoked = false;
  if (options.publish) {
    registry = readRegistryIdentity();
    if (registry) {
      verifyRegistryIdentity(registry, digests);
      outcome = "already_published_exact";
    } else {
      publishInvoked = true;
      const publish = spawn("npm", [
        "publish",
        tarballPath,
        "--access",
        "public",
        "--registry",
        registryUrl,
      ]);
      if (publish.status !== 0) {
        const afterAmbiguity = readRegistryIdentity();
        if (!afterAmbiguity) {
          throw new Error(
            "publish outcome is unknown and exact registry identity is absent; do not retry",
          );
        }
        verifyRegistryIdentity(afterAmbiguity, digests);
        registry = afterAmbiguity;
        outcome = "published_exact_after_ambiguous_response";
      } else {
        registry = readRegistryIdentity();
        if (!registry) {
          throw new Error(
            "publish returned success but exact registry identity is absent",
          );
        }
        verifyRegistryIdentity(registry, digests);
        outcome = "published_exact";
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outcome,
        source: {
          ref: head,
          tree,
          reviewedPackageRef,
          reviewedSourceTree,
          reviewedCliTree,
          reviewedPackageLockBlob,
          reviewedManifestBlob,
        },
        package: {
          name: packageName,
          version: packageVersion,
          filename: packResult.filename,
          sha1: digests.sha1,
          sha256: digests.sha256,
          integrity: digests.integrity,
        },
        registryUrl,
        registry,
        artifactVerification,
        publishInvocationCount: publishInvoked ? 1 : 0,
        publicationEffect:
          outcome === "published_exact"
            ? "accepted"
            : outcome === "published_exact_after_ambiguous_response"
              ? "accepted_after_ambiguous_response"
              : "none",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function parseArguments(argv) {
  const parsed = {
    expectedRef: null,
    expectedTree: null,
    publish: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--publish") {
      parsed.publish = true;
      continue;
    }
    if (argument === "--expected-ref" || argument === "--expected-tree") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--expected-ref") parsed.expectedRef = value;
      if (argument === "--expected-tree") parsed.expectedTree = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!/^[0-9a-f]{40}$/.test(parsed.expectedRef ?? "")) {
    throw new Error("--expected-ref must be an exact 40-character commit SHA");
  }
  if (!/^[0-9a-f]{40}$/.test(parsed.expectedTree ?? "")) {
    throw new Error("--expected-tree must be an exact 40-character tree SHA");
  }
  return parsed;
}

function git(args) {
  return run("git", args).trim();
}

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawn(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readRegistryIdentity() {
  const result = spawn("npm", [
    "view",
    `${packageName}@${packageVersion}`,
    "--json",
    "--prefer-online",
    "--registry",
    registryUrl,
  ]);
  if (result.status === 0) {
    const metadata = JSON.parse(result.stdout);
    return {
      name: metadata.name,
      version: metadata.version,
      dist: {
        integrity: metadata.dist?.integrity,
        shasum: metadata.dist?.shasum,
      },
    };
  }
  if (/\bE404\b|404 Not Found/i.test(result.stderr)) return null;
  throw new Error("exact registry identity readback failed without a 404");
}

function verifyRegistryIdentity(registry, digests) {
  if (
    registry.name !== packageName ||
    registry.version !== packageVersion ||
    registry.dist?.integrity !== digests.integrity ||
    registry.dist?.shasum !== digests.sha1
  ) {
    throw new Error("registry identity or digest differs from reviewed bytes");
  }
}

async function verifyPackedArtifact(tarballPath) {
  const entries = run("tar", ["-tzf", tarballPath]).trim().split("\n");
  if (
    entries.some(
      (entry) =>
        !entry.startsWith("package/") || entry.split("/").includes(".."),
    )
  ) {
    throw new Error("packed CLI contains an unsafe extraction path");
  }
  // Keep extraction under the package so Node can use existing dependencies.
  // This is an offline artifact check, not a fresh-install claim.
  const fixture = await mkdtemp(
    path.join(packageDirectory, ".release-verification-"),
  );
  try {
    run("tar", ["-xzf", tarballPath, "-C", fixture]);
    const packageRoot = await realpath(path.join(fixture, "package"));
    const binPath = await realpath(path.join(packageRoot, "dist", "main.js"));
    if (binPath !== path.join(packageRoot, "dist", "main.js")) {
      throw new Error("packed fonte binary resolves outside its declared path");
    }
    const versionStdout = run(
      process.execPath,
      [binPath, "--version"],
      fixture,
    );
    if (versionStdout !== `${packageName} ${packageVersion}\n`) {
      throw new Error("packed fonte binary reported an unexpected version");
    }
    return {
      status: "observed",
      method: "offline_packed_artifact",
      dependencyInstallation: false,
      cleanInstallObserved: false,
      manifest: { name: packageName, version: packageVersion },
      bin: { manifestTarget: "./dist/main.js" },
      version: {
        command: "node package/dist/main.js --version",
        stdout: versionStdout,
      },
    };
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
