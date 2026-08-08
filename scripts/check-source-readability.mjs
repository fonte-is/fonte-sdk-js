import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { packageOrder, root } from "./workspace-utils.mjs";

const maximumFunctionLines = 120;
const policies = [
  ...packageOrder.map((name) => ({
    directory: join(root, "packages", name, "src"),
    maximumModuleLines: 250,
  })),
  { directory: join(root, "scripts"), maximumModuleLines: 250 },
  { directory: join(root, "tests"), maximumModuleLines: 350 },
];
const deferredMarkers = ["TO" + "DO", "FIX" + "ME", "HA" + "CK"];
const typeCheckEscapes = ["@ts-" + "ignore", "@ts-" + "nocheck"];

const sourceFiles = (directory, maximumModuleLines) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, maximumModuleLines);
    return /\.(?:mjs|tsx?)$/.test(entry.name)
      ? [{ path, maximumModuleLines }]
      : [];
  });

const violations = [];
const files = policies
  .flatMap(({ directory, maximumModuleLines }) =>
    sourceFiles(directory, maximumModuleLines),
  )
  .sort((left, right) => left.path.localeCompare(right.path));
for (const { path, maximumModuleLines } of files) {
  const text = readFileSync(path, "utf8");
  const scriptKind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const moduleLines = file.getLineAndCharacterOfPosition(file.end).line + 1;
  if (moduleLines > maximumModuleLines) {
    violations.push(
      `${relative(root, path)} has ${moduleLines} lines; maximum is ${maximumModuleLines}`,
    );
  }
  if (
    deferredMarkers.some((marker) => text.includes(marker)) ||
    typeCheckEscapes.some((marker) => text.includes(marker))
  ) {
    violations.push(
      `${relative(root, path)} contains a deferred-work or type-check escape`,
    );
  }

  const inspect = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start = file.getLineAndCharacterOfPosition(
        node.getStart(file),
      ).line;
      const end = file.getLineAndCharacterOfPosition(node.end).line;
      const functionLines = end - start + 1;
      if (functionLines > maximumFunctionLines) {
        const name = node.name?.getText(file) ?? "anonymous function";
        violations.push(
          `${relative(root, path)}:${start + 1} ${name} has ${functionLines} lines; maximum is ${maximumFunctionLines}`,
        );
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(file);
}

assert.deepEqual(violations, [], violations.join("\n"));
console.log(
  JSON.stringify({
    ok: true,
    files: files.length,
    modulePolicies: {
      packageSource: 250,
      scripts: 250,
      testsAndConsumers: 350,
    },
    maximumFunctionLines,
  }),
);
