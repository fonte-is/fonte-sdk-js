import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectory = path.join(root, "packages", "cli");
const packageName = "@fonte-is/cli";
const packageVersion = "0.2.0";
const registryUrl = "https://registry.npmjs.org/";
const reviewedPackageRef = "9f682498864534031611520059cbc0d11d041916";
const reviewedSourceTree = "101863430e72514e46816ce0b3c8902cf3927b65";
const reviewedCliTree = "f1f4c4f02b8ec405856edd8efb1bb7217f41665d";
const reviewedPackageLockBlob = "ab4b2841f02b25245b4fb7274ff9cb5ce9814cb7";
const reviewedManifestBlob = "28b092ceddfc4d9afad2922a2d5b62e5d00ee4c0";
const reviewedTarballDigests = {
  sha1: "e4ee7f62b6575754159051464159f17d920156f9",
  sha256: "947657391a6b87e12354f20f4aa035d1fb09a2e30f3c03342b94d505fcec113f",
  integrity:
    "sha512-+QwsGOMlmRODGB5tgUudTsY28EKg8S5DpJW/ni5E3ueBmD2MUpacFob4tcrQeutbI8XmpYAfVm+zAkNL11FOrA==",
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
