import { join } from "node:path";
import { readJson, root, run } from "./workspace-utils.mjs";

const packs = join(root, ".artifacts", "packs");
const report = readJson(join(packs, "pack-report.json"));

for (const packed of report.packages) {
  const tarball = join(packs, packed.filename);
  run("npx", ["publint", "run", tarball, "--strict", "--pack=false"]);
  run("npx", [
    "attw",
    tarball,
    "--profile",
    "esm-only",
    "--no-emoji",
    "--no-color",
  ]);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      packages: report.packages.map(({ name, filename }) => ({
        name,
        filename,
      })),
      checks: ["publint-strict", "arethetypeswrong-esm-only"],
    },
    null,
    2,
  )}\n`,
);
