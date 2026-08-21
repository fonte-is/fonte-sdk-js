import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectories = ["core", "react", "nextjs", "cli"];

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

const sourceFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
};

test("the public graph keeps package-specific release versions", async () => {
  const entries = (await readdir(path.join(root, "packages"))).sort();
  assert.deepEqual(entries, packageDirectories.toSorted());
  const manifests = await Promise.all(
    packageDirectories.map((name) => readJson(`packages/${name}/package.json`)),
  );
  assert.deepEqual(
    manifests.map(({ name }) => name),
    ["@fonte-is/core", "@fonte-is/react", "@fonte-is/nextjs", "@fonte-is/cli"],
  );
  assert.deepEqual(
    Object.fromEntries(manifests.map(({ name, version }) => [name, version])),
    {
      "@fonte-is/core": "0.1.0",
      "@fonte-is/react": "0.1.0",
      "@fonte-is/nextjs": "0.1.0",
      "@fonte-is/cli": "0.1.2",
    },
  );
});

test("dependency edges point only from framework bindings to Core", async () => {
  const core = await readJson("packages/core/package.json");
  const react = await readJson("packages/react/package.json");
  const nextjs = await readJson("packages/nextjs/package.json");
  const cli = await readJson("packages/cli/package.json");
  assert.deepEqual(core.dependencies ?? {}, {});
  assert.deepEqual(core.peerDependencies ?? {}, {});
  assert.deepEqual(react.dependencies, { "@fonte-is/core": "0.1.0" });
  assert.deepEqual(nextjs.dependencies, {
    "@fonte-is/core": "0.1.0",
    "@fonte-is/react": "0.1.0",
  });
  assert.deepEqual(cli.dependencies, { "openid-client": "6.8.5" });
  assert.deepEqual(cli.peerDependencies ?? {}, {});
});

test("the CLI package has one stable binary and one operator client surface", async () => {
  const cli = await readJson("packages/cli/package.json");
  assert.deepEqual(cli.bin, { fonte: "./dist/main.js" });
  assert.equal(cli.main, undefined);
  assert.deepEqual(cli.exports, {
    "./operator-client": {
      types: "./dist/operator-client.d.ts",
      import: "./dist/operator-client.js",
    },
  });
});

test("server entry points are Node-only conditional exports", async () => {
  const core = await readJson("packages/core/package.json");
  const nextjs = await readJson("packages/nextjs/package.json");
  for (const manifest of [core, nextjs]) {
    assert.deepEqual(Object.keys(manifest.exports["./server"]).sort(), [
      "node",
      "types",
    ]);
    assert.deepEqual(Object.keys(manifest.typesVersions["*"]).sort(), [
      "installation-verification",
      "server",
    ]);
    assert.deepEqual(manifest.typesVersions["*"]["server"], [
      "./dist/server.d.ts",
    ]);
  }
});

test("Core has no framework or provider dependency or import", async () => {
  const forbidden =
    /^(?:react|react\/|next|next\/|stripe|@stripe\/|@fonte-is\/(?:react|nextjs|stripe))(?:$|\/)/;
  for (const file of await sourceFiles(
    path.join(root, "packages", "core", "src"),
  )) {
    const text = await readFile(file, "utf8");
    const specifiers = [
      ...text.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ].map((match) => match[2]);
    for (const specifier of specifiers) {
      assert.equal(
        forbidden.test(specifier),
        false,
        `${path.relative(root, file)} imports forbidden dependency ${specifier}`,
      );
    }
  }
});

test("deferred and experimental quarry surfaces are absent", async () => {
  const files = (
    await Promise.all(
      packageDirectories.map((name) =>
        sourceFiles(path.join(root, "packages", name, "src")),
      ),
    )
  ).flat();
  const forbiddenFiles = new Set(["campaign.ts", "checkout.ts", "cli.ts"]);
  assert.equal(
    files.some((file) => forbiddenFiles.has(path.basename(file))),
    false,
  );
  const allSource = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  for (const forbidden of [
    "@fonte-is/stripe",
    "moneyLoop",
    "checkoutBinding",
  ]) {
    assert.equal(
      allSource.includes(forbidden),
      false,
      `found excluded source surface ${forbidden}`,
    );
  }
});

test("runtime exports stay intentionally narrow", async () => {
  const modules = [
    ["@fonte-is/core", ["createCapture"]],
    [
      "@fonte-is/core/installation-verification",
      [
        "FONTE_CONFIG_VERSION",
        "INSTALLATION_VERIFICATION_SCHEMA_VERSION",
        "INSTALLATION_VERIFICATION_SDK_VERSION",
        "normalizeInstallationAttemptId",
        "normalizeInstallationVerification",
      ],
    ],
    ["@fonte-is/core/server", ["FonteApiError", "collect", "createClient"]],
    ["@fonte-is/react", ["FonteProvider", "useFonte"]],
    ["@fonte-is/nextjs", ["FonteProvider", "useFonte"]],
    ["@fonte-is/nextjs/server", ["collect"]],
    [
      "@fonte-is/nextjs/installation-verification",
      [
        "FONTE_CONFIG_VERSION",
        "INSTALLATION_VERIFICATION_ADAPTER_ID",
        "INSTALLATION_VERIFICATION_ADAPTER_VERSION",
        "INSTALLATION_VERIFICATION_SCHEMA_VERSION",
        "INSTALLATION_VERIFICATION_SDK_VERSION",
        "normalizeInstallationAttemptId",
        "normalizeInstallationVerification",
        "normalizeInstallationVerificationConfig",
      ],
    ],
  ];
  for (const [specifier, expected] of modules) {
    assert.deepEqual(
      Object.keys(await import(specifier)).sort(),
      expected.toSorted(),
      specifier,
    );
  }
});
