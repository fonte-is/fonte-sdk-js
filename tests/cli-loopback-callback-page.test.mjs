import assert from "node:assert/strict";
import test from "node:test";
import { renderCallbackPage } from "../packages/cli/dist/loopback-callback-page.js";

test("OAuth status page renders pending without claiming completion", () => {
  const page = renderCallbackPage("pending");

  assert.match(page, /Completing authorization/);
  assert.match(page, /Your terminal is validating the grant\./);
  assert.match(page, /http-equiv="refresh" content="1"/);
  assert.doesNotMatch(page, /Authorization complete|You’re almost there/);
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

test("OAuth status page renders completion only as a final projection", () => {
  const page = renderCallbackPage("complete");

  assert.match(page, /Authorization complete/);
  assert.match(page, /The authorization grant is ready in your terminal\./);
  assert.doesNotMatch(page, /http-equiv="refresh"/);
  assert.match(page, /data-outcome="complete"/);
  assert.match(page, /role="status"/);
});

test("OAuth status page keeps failure and expiry generic", () => {
  const failed = renderCallbackPage("failed");
  const expired = renderCallbackPage("expired");

  assert.match(failed, /Authorization not completed/);
  assert.match(expired, /Authorization expired/);
  for (const page of [failed, expired]) {
    assert.match(page, /No credential was stored by this page\./);
    assert.match(page, /role="alert"/);
    assert.doesNotMatch(page, /http-equiv="refresh"/);
  }
  assert.match(failed, /data-outcome="failed"/);
  assert.match(expired, /data-outcome="expired"/);
});
