import assert from "node:assert/strict";
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

console.log(
  JSON.stringify({
    ok: true,
    consumer: "react-19",
    package: "@fonte-is/react@0.1.0",
  }),
);
