import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FonteProvider, useFonte } from "@fonte-is/react";

test("React provider exposes the exact supplied Core capture", () => {
  const capture = { page() {} };
  function Probe() {
    return createElement(
      "span",
      null,
      useFonte() === capture ? "same" : "different",
    );
  }
  const markup = renderToStaticMarkup(
    createElement(FonteProvider, { capture }, createElement(Probe)),
  );
  assert.equal(markup, "<span>same</span>");
});

test("React hook fails closed outside the provider", () => {
  function Probe() {
    useFonte();
    return null;
  }
  assert.throws(
    () => renderToStaticMarkup(createElement(Probe)),
    /fonte_provider_missing/,
  );
});
