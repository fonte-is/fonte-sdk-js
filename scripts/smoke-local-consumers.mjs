import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  packageOrder,
  readJson,
  resetDirectory,
  root,
  run,
} from "./workspace-utils.mjs";

const packs = join(root, ".artifacts", "packs");
const report = readJson(join(packs, "pack-report.json"));
const consumers = join(root, ".artifacts", "consumers");
const fixtures = join(root, "tests", "consumers");
resetDirectory(consumers);

const tarballs = new Map(
  packageOrder.map((shortName) => {
    const name = `@fonte-is/${shortName}`;
    const packed = report.packages.find((item) => item.name === name);
    if (!packed) throw new Error(`missing packed artifact for ${name}`);
    return [shortName, join(packs, packed.filename)];
  }),
);

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function copyFixture(name, destination) {
  const source = join(fixtures, name);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(join(source, entry.name), join(destination, entry.name), {
      recursive: entry.isDirectory(),
    });
  }
}

function installConsumer(name, dependencies, options = {}) {
  const directory = join(consumers, name);
  mkdirSync(directory, { recursive: true });
  write(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: `fonte-${name}-consumer`,
        private: true,
        version: "0.0.0",
        type: "module",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  run(
    "npm",
    [
      "install",
      ...(options.offline === false ? [] : ["--offline"]),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: directory },
  );
  for (const [packageName, specifier] of Object.entries(dependencies)) {
    if (!packageName.startsWith("@fonte-is/")) continue;
    const installed = readJson(
      join(directory, "node_modules", packageName, "package.json"),
    );
    assert.equal(installed.name, packageName);
    assert.equal(installed.version, "0.1.0");
    assert.ok(
      specifier.startsWith("file:"),
      `${packageName} was not installed from a tarball`,
    );
    assert.equal(
      existsSync(join(directory, "node_modules", packageName, "src")),
      false,
    );
  }
  return directory;
}

const fileDependency = (shortName) => `file:${tarballs.get(shortName)}`;

const vanilla = installConsumer("vanilla", {
  "@fonte-is/core": fileDependency("core"),
});
copyFixture("vanilla", vanilla);
run("node", ["index.mjs"], { cwd: vanilla });

const react = installConsumer("react-19", {
  "@fonte-is/core": fileDependency("core"),
  "@fonte-is/react": fileDependency("react"),
  react: "19.2.0",
  "react-dom": "19.2.0",
});
copyFixture("react", react);
run("node", ["index.mjs"], { cwd: react });

function createNextConsumer(name, versions, options = {}) {
  const directory = installConsumer(
    name,
    {
      "@fonte-is/core": fileDependency("core"),
      "@fonte-is/react": fileDependency("react"),
      "@fonte-is/nextjs": fileDependency("nextjs"),
      next: versions.next,
      react: versions.react,
      "react-dom": versions.react,
    },
    options,
  );
  const manifest = readJson(join(directory, "package.json"));
  manifest.scripts = { build: "next build", start: "next start" };
  write(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  copyFixture("nextjs", directory);
  run("npm", ["run", "build"], {
    cwd: directory,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
  });
  assert.ok(
    existsSync(join(directory, ".next", "BUILD_ID")),
    `${name} did not emit BUILD_ID`,
  );
  return directory;
}

const next16 = createNextConsumer("nextjs-16-react-19", {
  next: "16.2.11",
  react: "19.2.0",
});
const next15 = createNextConsumer(
  "nextjs-15-react-18",
  { next: "15.5.23", react: "18.2.0" },
  { offline: false },
);

const receipt = {
  ok: true,
  installedFrom: "npm-pack-tarballs",
  consumers: [
    { name: "vanilla", root: resolve(vanilla), status: "passed" },
    { name: "react-19", root: resolve(react), status: "passed" },
    {
      name: "nextjs-16-react-19",
      root: resolve(next16),
      next: "16.2.11",
      react: "19.2.0",
      status: "production-build-passed",
    },
    {
      name: "nextjs-15-react-18",
      root: resolve(next15),
      next: "15.5.23",
      react: "18.2.0",
      status: "production-build-passed",
    },
  ],
  published: false,
};
write(
  join(consumers, "consumer-report.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
