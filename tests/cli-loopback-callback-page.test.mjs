import assert from "node:assert/strict";
import test from "node:test";
import { renderCallbackPage } from "../packages/cli/dist/loopback-callback-page.js";

test("OAuth callback uses the canonical Fonte access-page language", () => {
  const page = renderCallbackPage("success");

  assert.match(page, /Authorization complete/);
  assert.match(page, /Return to your terminal to continue\./);
  assert.match(page, /viewBox="0 0 38 38"/);
  assert.match(page, /M34\.7188 15\.7682/);
  assert.match(page, /<main aria-labelledby="callback-title">/);
  assert.match(page, /class="status-icon"/);
  assert.match(page, /max-width: 360px/);
  assert.match(page, /font-size: 24px/);
  assert.match(page, /--canvas: #ffffff/);
  assert.match(page, /--canvas: #141915/);
  assert.match(page, /prefers-color-scheme: dark/);
  assert.match(page, /name="color-scheme" content="light dark"/);
  assert.match(
    page,
    /<link rel="icon" type="image\/svg\+xml" sizes="any" href="data:image\/svg\+xml,%3Csvg/,
  );
  assert.match(page, /%23007DF9/);
  assert.doesNotMatch(
    page,
    /brand-mark|brand-name|radial-gradient|Fonte CLI|class="panel"|class="card"|box-shadow|<button/,
  );
});

test("OAuth callback renders a truthful failure state", () => {
  const page = renderCallbackPage("failure");

  assert.match(page, /Authorization not completed/);
  assert.match(page, /No credential was stored by this page\./);
  assert.match(page, /data-outcome="failure"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /\[data-outcome="failure"\] \.status-icon/);
});
