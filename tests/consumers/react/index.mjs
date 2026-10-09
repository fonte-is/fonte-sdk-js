import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FonteProvider, useFonte } from "@fonte-is/react";

const capture = {
  async page() {
    return { deliveries: [] };
  },
};

function Probe() {
  return createElement(
    "span",
    null,
    useFonte() === capture ? "ready" : "wrong",
  );
}

const output = renderToStaticMarkup(
  createElement(FonteProvider, { capture }, createElement(Probe)),
);
assert.equal(output, "<span>ready</span>");
const require = createRequire(import.meta.url);
const packagePath = path.join(
  path.dirname(require.resolve("@fonte-is/react")),
  "..",
  "package.json",
);
const installed = JSON.parse(readFileSync(packagePath, "utf8"));

console.log(
  JSON.stringify({
    ok: true,
    consumer: "react-19",
    package: `${installed.name}@${installed.version}`,
  }),
);
