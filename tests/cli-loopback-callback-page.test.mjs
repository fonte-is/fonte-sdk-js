import assert from "node:assert/strict";
import test from "node:test";
import { renderCallbackPage } from "../packages/cli/dist/loopback-callback-page.js";

test("OAuth status page renders pending without claiming completion", () => {
  const page = renderCallbackPage("pending");

  assert.match(page, /Completing authorization/);
  assert.match(page, /Your terminal is validating the grant\./);
  assert.match(page, /http-equiv="refresh" content="1"/);
    assert.doesNotMatch(page, /Authorization complete|You’re almost there/);
    assert.doesNotMatch(page, /<script|window\.close/);
    assert.match(page, /viewBox="0 0 38 38"/);
    assert.match(page, /M34\.7188 15\.7682/);
    assert.doesNotMatch(page, /You’re ready to continue|You can close this tab/);
    assert.match(page, /data-outcome="pending"/);
    assert.match(page, /role="status"/);
  assert.match(page, /<main aria-labelledby="callback-title">/);
});

test("OAuth status page renders completion only as a final projection", () => {
  const page = renderCallbackPage("complete");

  assert.match(page, /You’re ready to continue\./);
  assert.match(page, /Return to your terminal\. You can close this tab\./);
  assert.doesNotMatch(page, /http-equiv="refresh"/);
  assert.match(page, /data-outcome="complete"/);
  assert.match(page, /role="status"/);
  assert.match(
    page,
    /<script>try \{ window\.close\(\); \} catch \{\}<\/script>/,
  );
  assert.match(page, /You can close this tab\./);
});

test("OAuth status page keeps failure and expiry generic", () => {
  const failed = renderCallbackPage("failed");
  const expired = renderCallbackPage("expired");

  assert.match(failed, /Authorization not completed/);
  assert.match(expired, /Authorization expired/);
  for (const page of [failed, expired]) {
    assert.match(page, /Return to your terminal/);
    assert.match(page, /role="alert"/);
    assert.doesNotMatch(page, /http-equiv="refresh"/);
    assert.doesNotMatch(page, /<script|window\.close/);
    assert.doesNotMatch(page, /http-equiv="refresh"|You’re ready to continue/);
  }
  assert.match(failed, /data-outcome="failed"/);
  assert.match(expired, /data-outcome="expired"/);
});

test("OAuth page assets are self-contained without scripts or external requests", () => {
  const page = renderCallbackPage("complete");
  const font = page.match(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(font, "the page embeds its font instead of depending on a CDN");
  assert.equal(
    Buffer.from(font[1], "base64").subarray(0, 4).toString(),
    "wOF2",
  );
  assert.doesNotMatch(
    page,
    /<script|<form|(?:src|href)="https?:|url\(["']?https?:|@import/i,
  );
});
