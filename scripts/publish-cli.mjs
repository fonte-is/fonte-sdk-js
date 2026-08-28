import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectory = path.join(root, "packages", "cli");
const packageName = "@fonte-is/cli";
const packageVersion = "0.2.1";
const registryUrl = "https://registry.npmjs.org/";
const reviewedPackageRef = "13b184e587a751ea420548fbcdb77259ec91c0df";
const reviewedTarballSha256 =
  "088907c260975a29523245db9e2d7a393561f9c01dad50d3b846a1f599920743";
const receiptPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (digests.sha256 !== reviewedTarballSha256) {
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

  let outcome = "dry_run_ready_after_fon_223";
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
        prerequisite: {
          issue: "FON-223",
          releaseReceipt: options.fon223ReleaseReceipt,
          requiredBeforePublish: true,
        },
        source: { ref: head, tree, reviewedPackageRef },
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
        install: {
          command: `npm install --save-exact --registry=${registryUrl} ${packageName}@${packageVersion}`,
          executable: "./node_modules/.bin/fonte",
          versionCommand: "./node_modules/.bin/fonte --version",
          expectedVersion: `${packageName} ${packageVersion}`,
          unversionedNpxAllowed: false,
        },
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
    fon223ReleaseReceipt: null,
    publish: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--publish") {
      parsed.publish = true;
      continue;
    }
    if (
      argument === "--expected-ref" ||
      argument === "--expected-tree" ||
      argument === "--fon-223-release-receipt"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--expected-ref") parsed.expectedRef = value;
      if (argument === "--expected-tree") parsed.expectedTree = value;
      if (argument === "--fon-223-release-receipt") {
        parsed.fon223ReleaseReceipt = value;
      }
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
  if (
    parsed.publish &&
    !receiptPattern.test(parsed.fon223ReleaseReceipt ?? "")
  ) {
    throw new Error(
      "--publish requires an exact --fon-223-release-receipt UUID",
    );
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
