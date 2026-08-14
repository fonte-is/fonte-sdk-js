import assert from "node:assert/strict";
import test from "node:test";
import { renderCallbackPage } from "../packages/cli/dist/loopback-callback-page.js";

test("OAuth callback uses the canonical Fonte mark and restrained handoff copy", () => {
  const page = renderCallbackPage("success");

  assert.match(page, /Authorization complete/);
  assert.match(page, /Return to your terminal to continue\./);
  assert.match(page, /viewBox="0 0 38 38"/);
  assert.match(page, /M34\.7188 15\.7682/);
  assert.doesNotMatch(
    page,
    /brand-mark|radial-gradient|Fonte CLI|class="panel"|class="status"/,
  );
});

test("OAuth callback renders a truthful failure state", () => {
  const page = renderCallbackPage("failure");

  assert.match(page, /Authorization not completed/);
  assert.match(page, /No credential was stored by this page\./);
  assert.match(page, /data-outcome="failure"/);
});
