import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { createWebsiteForms } from "../packages/core/dist/website/forms.js";
import { createFormSubmission } from "../packages/core/dist/website/form-submit.js";

test("renderer is inert during server rendering", () => {
  const forms = createWebsiteForms({
    submit() {
      throw Error("not called");
    },
    stylesheetUrl: "https://assets.example/release.css",
  });
  forms.apply(null);
  forms.navigate();
  forms.destroy();
  assert.deepEqual(forms.counts(), { mounted: 0, unavailable: 0 });
});

test("frozen intent retries by identity and changed intent gets a fresh UUID", async () => {
  const calls = [];
  const results = [];
  let resolve;
  const state = createFormSubmission(
    (intent) => {
      calls.push(intent);
      return new Promise((done) => (resolve = done));
    },
    (result) => results.push(result),
    () => {},
  );
  const form = { publicId: "public", publishedRevision: 1 };
  state.attempt(form, { email: "fixture@example.test", firstName: "Fixture" });
  state.attempt(form, { email: "other@example.test" });
  assert.equal(calls.length, 1);
  assert(Object.isFrozen(calls[0]));
  assert(Object.isFrozen(calls[0].values));
  assert.match(calls[0].requestId, /^[a-f0-9-]{36}$/);
  resolve({ kind: "unavailable", retryable: true });
  await Promise.resolve();
  state.attempt(form, { email: "fixture@example.test", firstName: "Fixture" });
  assert.equal(calls[0], calls[1]);
  resolve({ kind: "unavailable", retryable: true });
  await Promise.resolve();
  state.change();
  state.attempt(form, { email: "fixture@example.test", firstName: "Fixture" });
  assert.notEqual(calls[2].requestId, calls[0].requestId);
  state.destroy();
  resolve({ kind: "completed", submissionId: "fixture-only" });
  await Promise.resolve();
  assert.equal(results.length, 2);
});

let server, browser, origin;
const evidence =
  process.env.FONTE_WEBSITE_FORMS_EVIDENCE ??
  "/private/tmp/fon822-website-forms-evidence";
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://fixture").pathname;
      const file =
        path === "/forms.css"
          ? "../packages/core/src/website/forms.css"
          : path.startsWith("/dist/")
            ? `../packages/core/dist/${path.slice(6)}`
            : path.startsWith("/fixtures/")
              ? `fixtures/website-forms/${path.slice(10)}`
              : "fixtures/website-forms/page.html";
      if (file.includes("..", 3) || path === "/missing.css")
        throw Error("not found");
      res.writeHead(200, {
        "content-type": file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".css")
            ? "text/css"
            : "text/javascript",
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'",
      });
      res.end(await readFile(new URL(file, import.meta.url)));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromium.executablePath()) ? {} : { channel: "chrome" }),
  });
  await mkdir(evidence, { recursive: true });
  await writeFile(
    `${evidence}/profile.json`,
    JSON.stringify(
      {
        scope: "Frontend port fixture only; no durable submission",
        browser: browser.version(),
        headless: true,
        cpu: "unthrottled",
        network: "local loopback",
        runs: 1,
      },
      null,
      2,
    ),
  );
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise((done) => server.close(done));
});
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(`${origin}/host`);
  await page.waitForFunction(() => window.fixtureReady);
  return page;
}
const surface = (page) => page.locator("#initial fonte-form");
const email = (page) => surface(page).locator('input[name="email"]');
const send = (page) =>
  surface(page).getByRole("button", { name: "Subscribe", exact: true });
const mounted = (page, number = 1) =>
  page.waitForFunction(
    (number) => window.forms.counts().mounted === number,
    number,
  );
const install = (page) => page.evaluate(() => window.install());
const fill = (page) => email(page).fill("fixture@example.test");

test("strict CSP, hostile host CSS, safe copy and denied collection preserve usable forms", async (t) => {
  const page = await fixture(t);
  const snapshot = await page.evaluate(() => ({
    body: document.body.getAttribute("style"),
    classes: document.body.className,
    input: document.getElementById("host-input").outerHTML,
  }));
  await install(page);
  await page.evaluate(() => window.startDeniedRuntime());
  await mounted(page);
  await page.waitForFunction(
    () => window.runtime.getStatus().collection === "denied",
  );
  assert.equal(await surface(page).locator("script").count(), 0);
  assert.equal(
    await surface(page).getByRole("heading").textContent(),
    "Updates <script>are text</script>",
  );
  assert(await surface(page).getByText("Updates from the fixture").isVisible());
  assert(
    await surface(page)
      .getByText("You will need to confirm your subscription by email.")
      .isVisible(),
  );
  assert.equal(
    await email(page).evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    ),
    "rgb(255, 255, 255)",
  );
  assert.equal(
    await send(page).evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(22, 75, 93)",
  );
  await fill(page);
  await send(page).click();
  await surface(page).getByText("Configured completed success").waitFor();
  assert.equal(await email(page).count(), 0);
  assert.deepEqual(
    await page.evaluate(() => ({
      body: document.body.getAttribute("style"),
      classes: document.body.className,
      input: document.getElementById("host-input").outerHTML,
    })),
    snapshot,
  );
  assert.deepEqual(await page.evaluate(() => window.violations), []);
  assert.equal(await page.evaluate(() => window.calls.length), 1);
});

test("Email remains required, disabled First name is absent, and unknown collection permits submit", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.form.firstNameEnabled = false;
    window.install();
    window.startDeniedRuntime("unknown");
  });
  await mounted(page);
  await page.waitForFunction(
    () => window.runtime.getStatus().collection === "unknown",
  );
  assert.equal(
    await surface(page).locator('input[name="firstName"]').count(),
    0,
  );
  await send(page).click();
  assert.equal(await page.evaluate(() => window.calls.length), 0);
  await email(page).fill("not-an-email");
  await send(page).click();
  assert.equal(await page.evaluate(() => window.calls.length), 0);
  await fill(page);
  await send(page).click();
  await surface(page).getByText("Configured completed success").waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls[0].values), {
    email: "fixture@example.test",
  });
});

test("initial, duplicate and dynamically added exact markers mount once in document order", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    document.getElementById("dynamic").innerHTML =
      '<div data-fonte-placement="newsletter" id="duplicate"></div><div data-fonte-placement="newsletter-extra"></div>';
    window.install();
  });
  await mounted(page);
  assert.equal(await page.locator("#duplicate fonte-form").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
    mounted: 1,
    unavailable: 1,
  });
  await page.evaluate(() => document.getElementById("initial").remove());
  await page.locator("#duplicate fonte-form input").first().waitFor();
  await page.evaluate(() => {
    const earlier = document.createElement("div");
    earlier.id = "earlier";
    earlier.setAttribute("data-fonte-placement", "newsletter");
    document.getElementById("content").prepend(earlier);
  });
  await page.locator("#earlier fonte-form input").first().waitFor();
  assert.equal(await page.locator("#duplicate fonte-form").count(), 0);
  assert.equal(await page.evaluate(() => window.observations.length), 1);
  assert.deepEqual(await page.evaluate(() => window.observations[0]), {
    childList: true,
    subtree: true,
  });
  await page.evaluate(() => {
    document
      .getElementById("earlier")
      .setAttribute("data-fonte-placement", "other-key");
    window.forms.navigate();
  });
  await page.locator("#duplicate fonte-form input").first().waitFor();
  assert.equal(await page.locator("#earlier fonte-form").count(), 0);
});

test("remove and reinsert cleanly rebind without duplicate submission listeners", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  await page.evaluate(() => {
    window.detached = document.getElementById("initial");
    window.detached.remove();
  });
  await mounted(page, 0);
  await page.evaluate(() =>
    document.getElementById("content").append(window.detached),
  );
  await mounted(page);
  await fill(page);
  await send(page).click();
  await surface(page).getByText("Configured completed success").waitFor();
  assert.equal(await page.evaluate(() => window.calls.length), 1);
});

test("route reevaluation reuses applied settings and stops inline observer when ineligible", async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.install([
      {
        key: "newsletter",
        presentation: "inline",
        paths: ["/host", "/news/*"],
        form: window.form,
      },
    ]),
  );
  await mounted(page);
  await page.evaluate(() => {
    history.pushState({}, "", "/other");
    window.forms.navigate();
  });
  await mounted(page, 0);
  await page.evaluate(() => {
    history.replaceState({}, "", "/news/item");
    window.forms.navigate();
  });
  await mounted(page);
  await page.evaluate(() => {
    history.replaceState({}, "", "/news");
    window.forms.navigate();
  });
  await mounted(page, 0);
});

for (const presentation of ["popup", "slide_in"])
  test(`${presentation} supports keyboard-only native modality, Escape and connected focus restoration`, async (t) => {
    const page = await fixture(t);
    await page.locator("#opener").focus();
    await page.evaluate(
      (presentation) =>
        window.install([
          { key: "overlay", presentation, paths: ["*"], form: window.form },
          {
            key: "other",
            presentation: "popup",
            paths: ["*"],
            form: window.form,
          },
        ]),
      presentation,
    );
    await mounted(page);
    const overlay = page.locator("fonte-form");
    assert(
      await overlay
        .locator("dialog")
        .evaluate((node) => node.matches(":modal")),
    );
    assert(
      await overlay
        .locator('input[name="email"]')
        .evaluate((node) => node === node.getRootNode().activeElement),
    );
    await page.keyboard.type("fixture@example.test");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert(
        await page.evaluate(
          () => document.activeElement?.tagName === "FONTE-FORM",
        ),
      );
    }
    await overlay.locator('input[name="email"]').focus();
    await page.keyboard.press("Enter");
    await overlay.getByText("Configured completed success").waitFor();
    await page.keyboard.press("Escape");
    assert(
      await page
        .locator("#opener")
        .evaluate((node) => document.activeElement === node),
    );
    await page.evaluate(() => {
      window.forms.navigate();
      window.forms.apply(
        window.settings([
          {
            key: "later",
            presentation: "popup",
            paths: ["*"],
            form: window.form,
          },
        ]),
      );
    });
    assert.equal(await page.locator("fonte-form").count(), 0);
  });

for (const presentation of ["popup", "slide_in"]) {
  test(`${presentation} native autofocus selects email once before surface readiness`, async (t) => {
    const page = await fixture(t);
    await page.locator("#opener").focus();
    await page.evaluate((presentation) => {
      window.openFocus = {
        calls: 0,
        transitions: [],
        autofocus: false,
        nativeEmail: false,
      };
      const focus = HTMLInputElement.prototype.focus;
      HTMLInputElement.prototype.focus = function (...args) {
        if (this.name === "email") window.openFocus.calls++;
        return focus.apply(this, args);
      };
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const email = this.querySelector('input[name="email"]');
        const root = this.getRootNode();
        window.openFocus.autofocus = email.autofocus;
        root.addEventListener("focusin", (event) =>
          window.openFocus.transitions.push(
            event.target.name || event.target.textContent,
          ),
        );
        const result = showModal.apply(this, args);
        window.openFocus.nativeEmail = root.activeElement === email;
        window.openFocus.mountedDuringOpen = window.forms.counts().mounted;
        return result;
      };
      window.install([
        { key: "overlay", presentation, paths: ["*"], form: window.form },
      ]);
    }, presentation);
    await mounted(page);
    assert.deepEqual(await page.evaluate(() => window.openFocus), {
      calls: 0,
      transitions: ["email"],
      autofocus: true,
      nativeEmail: true,
      mountedDuringOpen: 0,
    });
    assert(
      await page
        .locator('dialog input[name="email"]')
        .evaluate((node) => node.getRootNode().activeElement === node),
    );
    await page.keyboard.press("Escape");
    assert(
      await page
        .locator("#opener")
        .evaluate((node) => document.activeElement === node),
    );
  });
}

test("overlay explicitly focuses email when native modal autofocus leaves another target", async (t) => {
  const page = await fixture(t);
  await page.locator("#opener").focus();
  await page.evaluate(() => {
    window.fallbackFocus = {
      calls: 0,
      mountedAtFocus: null,
      nativeEmail: null,
    };
    const focus = HTMLInputElement.prototype.focus;
    HTMLInputElement.prototype.focus = function (...args) {
      if (this.name === "email") {
        window.fallbackFocus.calls++;
        window.fallbackFocus.mountedAtFocus = window.forms.counts().mounted;
      }
      return focus.apply(this, args);
    };
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      const result = showModal.apply(this, args);
      this.querySelector("button").focus();
      window.fallbackFocus.nativeEmail =
        this.getRootNode().activeElement ===
        this.querySelector('input[name="email"]');
      return result;
    };
    window.install([
      {
        key: "overlay",
        presentation: "popup",
        paths: ["*"],
        form: window.form,
      },
    ]);
  });
  await mounted(page);
  assert.deepEqual(await page.evaluate(() => window.fallbackFocus), {
    calls: 1,
    mountedAtFocus: 0,
    nativeEmail: false,
  });
  assert(
    await page
      .locator('dialog input[name="email"]')
      .evaluate((node) => node.getRootNode().activeElement === node),
  );
  await page.keyboard.press("Escape");
  assert(
    await page
      .locator("#opener")
      .evaluate((node) => document.activeElement === node),
  );
});

test("inline email has no autofocus and preserves the current host focus", async (t) => {
  const page = await fixture(t);
  await page.locator("#opener").focus();
  await install(page);
  await mounted(page);
  assert.equal(
    await email(page).evaluate(
      (node) => node.autofocus || node.hasAttribute("autofocus"),
    ),
    false,
  );
  assert(
    await page
      .locator("#opener")
      .evaluate((node) => document.activeElement === node),
  );
});

test("disconnected overlay opener is not restored and host classes/styles stay intact", async (t) => {
  const page = await fixture(t);
  await page.locator("#opener").focus();
  await page.evaluate(() =>
    window.install([
      {
        key: "overlay",
        presentation: "popup",
        paths: ["*"],
        form: window.form,
      },
    ]),
  );
  await mounted(page);
  await page.evaluate(() => document.getElementById("opener").remove());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => [
      document.body.className,
      document.body.getAttribute("style"),
    ]),
    ["host-page", null],
  );
});

test("failed CSS never opens an unstyled overlay or traps host focus", async (t) => {
  const page = await fixture(t);
  await page.locator("#opener").focus();
  await page.evaluate(() =>
    window.install(
      [
        {
          key: "overlay",
          presentation: "popup",
          paths: ["*"],
          form: window.form,
        },
      ],
      "/missing.css",
    ),
  );
  await page.waitForFunction(() => !document.querySelector("fonte-form"));
  assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
    mounted: 0,
    unavailable: 1,
  });
  assert(
    await page
      .locator("#opener")
      .evaluate((node) => document.activeElement === node),
  );
  assert.equal(await page.locator("dialog").count(), 0);
});

test("double clicks stay one in-flight intent, ambiguous retry preserves UUID/values/revision", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  await fill(page);
  await page.evaluate(() => window.plan.push("defer"));
  await send(page).dblclick();
  assert.equal(await page.evaluate(() => window.calls.length), 1);
  assert(await send(page).isDisabled());
  await page.evaluate(() =>
    window.deferred.shift().reject(Error("Lost response")),
  );
  await surface(page)
    .getByRole("button", { name: "Retry", exact: true })
    .waitFor();
  await page.evaluate(() => window.plan.push("lost"));
  await surface(page)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await page.waitForFunction(() => window.calls.length === 2);
  assert.deepEqual(
    await page.evaluate(() => window.calls[0]),
    await page.evaluate(() => window.calls[1]),
  );
  assert(await page.evaluate(() => window.intents[0] === window.intents[1]));
  await email(page).fill("changed@example.test");
  await send(page).click();
  assert.notEqual(
    await page.evaluate(() => window.calls[2].requestId),
    await page.evaluate(() => window.calls[0].requestId),
  );
});

for (const [kind, copy] of [
  ["received", "Your request has been received."],
  ["completed", "Configured completed success"],
  ["confirmation_required", "Check your inbox to confirm your subscription."],
])
  test(`${kind} displays only its permitted result and releases inputs`, async (t) => {
    const page = await fixture(t);
    await install(page);
    await mounted(page);
    await fill(page);
    await page.evaluate(
      (kind) => window.plan.push({ kind, submissionId: "fixture-only" }),
      kind,
    );
    await send(page).click();
    await surface(page).getByText(copy, { exact: true }).waitFor();
    assert.equal(await email(page).count(), 0);
    assert.equal(await surface(page).locator("form").count(), 0);
  });

test("invalid fields and nonretryable unavailable expose no internal details", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  await fill(page);
  await page.evaluate(() =>
    window.plan.push({ kind: "invalid", field: "email" }),
  );
  await send(page).click();
  await surface(page).getByText("Enter a valid email address.").waitFor();
  assert.equal(await email(page).getAttribute("aria-invalid"), "true");
  await email(page).fill("changed@example.test");
  await page.evaluate(() =>
    window.plan.push({ kind: "unavailable", retryable: false }),
  );
  await send(page).click();
  await surface(page)
    .getByText("This form is currently unavailable.")
    .waitFor();
  assert(await send(page).isDisabled());
  assert.equal(
    await surface(page).getByRole("button", { name: "Retry" }).count(),
    0,
  );
  await page.evaluate(() =>
    document.getElementById("dynamic").append(document.createElement("span")),
  );
  await page.evaluate(() => Promise.resolve());
  assert(await send(page).isDisabled());
  await email(page).fill("another@example.test");
  assert(await send(page).isDisabled());
});

test("settings changed while typing preserve displayed copy until explicit review with new UUID", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  await fill(page);
  await page.evaluate(() => {
    window.plan.push("lost");
  });
  await send(page).click();
  await surface(page)
    .getByRole("button", { name: "Retry", exact: true })
    .waitFor();
  await page.evaluate(() => {
    const settings = window.settings();
    settings.revision = 2;
    Object.assign(settings.placements[0].form, {
      publishedRevision: 2,
      scopeLabel: "Changed public scope",
      headline: "Changed headline",
    });
    window.forms.apply(settings);
  });
  assert.equal(await email(page).inputValue(), "fixture@example.test");
  assert(await surface(page).getByText("Updates from the fixture").isVisible());
  assert.equal(
    await surface(page).getByText("Changed public scope").count(),
    0,
  );
  await surface(page)
    .getByRole("button", { name: "Review updated form" })
    .click();
  assert.equal(await email(page).inputValue(), "");
  assert(await surface(page).getByText("Changed public scope").isVisible());
  await fill(page);
  await send(page).click();
  assert.equal(await page.evaluate(() => window.calls[1].publishedRevision), 2);
  assert.notEqual(
    await page.evaluate(() => window.calls[1].requestId),
    await page.evaluate(() => window.calls[0].requestId),
  );
});

test("revision_changed requires actual updated settings and an explicit review without replay", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  await fill(page);
  await page.evaluate(() => window.plan.push({ kind: "revision_changed" }));
  await send(page).click();
  await surface(page)
    .getByText(
      "This form has changed. Review the updated form before submitting.",
    )
    .waitFor();
  assert(await send(page).isDisabled());
  assert(
    await surface(page)
      .getByRole("button", { name: "Updated form is not available yet" })
      .isDisabled(),
  );
  await page.evaluate(() => {
    const settings = window.settings();
    settings.placements[0].form.publishedRevision = 2;
    window.forms.apply(settings);
  });
  await surface(page)
    .getByRole("button", { name: "Review updated form" })
    .click();
  assert.equal(await page.evaluate(() => window.calls.length), 1);
  assert.equal(await email(page).inputValue(), "");
  await fill(page);
  await send(page).click();
  assert.equal(await page.evaluate(() => window.calls[1].publishedRevision), 2);
});

for (const operation of ["disable", "remove", "destroy"])
  test(`${operation} blocks new submissions and late results cannot remount or focus`, async (t) => {
    const page = await fixture(t);
    await install(page);
    await mounted(page);
    await fill(page);
    await page.evaluate(() => window.plan.push("defer"));
    await send(page).click();
    await page.evaluate((operation) => {
      if (operation === "destroy") window.forms.destroy();
      else if (operation === "remove")
        window.forms.apply({ ...window.settings(), placements: [] });
      else window.forms.apply(null);
      document.getElementById("opener").focus();
      window.deferred
        .shift()
        .resolve({ kind: "completed", submissionId: "fixture-only" });
    }, operation);
    await page.waitForFunction(() => !document.querySelector("fonte-form"));
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    assert(
      await page
        .locator("#opener")
        .evaluate((node) => document.activeElement === node),
    );
    assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
      mounted: 0,
      unavailable: 0,
    });
  });

test("before DOM readiness no surface opens, then one mounts", async (t) => {
  const page = await fixture(t);
  await page.goto(`${origin}/early`);
  await mounted(page);
  assert.equal(
    await page.evaluate(() => window.earlyReadyState),
    "interactive",
  );
  assert.equal(await page.evaluate(() => window.earlyCounts.mounted), 0);
});

test("added subtrees do not cause whole-document rescans and destroy disconnects observer", async (t) => {
  const page = await fixture(t);
  await install(page);
  await mounted(page);
  const scans = await page.evaluate(() => window.documentScans);
  await page.evaluate(() =>
    document.getElementById("dynamic").append(document.createElement("span")),
  );
  await page.evaluate(() => Promise.resolve());
  assert.equal(await page.evaluate(() => window.documentScans), scans);
  await page.evaluate(() => window.forms.destroy());
  const callbacks = await page.evaluate(() => window.observerCallbacks);
  await page.evaluate(() =>
    document.getElementById("dynamic").append(document.createElement("span")),
  );
  await page.evaluate(() => Promise.resolve());
  assert.equal(await page.evaluate(() => window.observerCallbacks), callbacks);
});

for (const presentation of ["inline", "popup"])
  test(`externally removed ${presentation} host clears state and late receipt cannot remount/focus`, async (t) => {
    const page = await fixture(t);
    await page.evaluate(
      (presentation) =>
        window.install([
          { key: "newsletter", presentation, paths: ["*"], form: window.form },
        ]),
      presentation,
    );
    await mounted(page);
    const view = page.locator("fonte-form");
    const input = view.locator('input[name="email"]');
    await input.fill("fixture@example.test");
    await page.evaluate(() => window.plan.push("defer"));
    await view.getByRole("button", { name: "Subscribe", exact: true }).click();
    await page.evaluate(() => {
      window.removedView = document.querySelector("fonte-form");
      window.removedView.remove();
      document.getElementById("host-input").focus();
    });
    await mounted(page, 0);
    assert.equal(
      await page.evaluate(() =>
        window.removedView.shadowRoot.querySelector('input[name="email"]'),
      ),
      null,
    );
    await page.evaluate(() =>
      window.deferred
        .shift()
        .resolve({ kind: "completed", submissionId: "fixture-only" }),
    );
    await page.evaluate(() => Promise.resolve());
    assert.equal(await page.locator("fonte-form").count(), 0);
    assert(
      await page
        .locator("#host-input")
        .evaluate((node) => document.activeElement === node),
    );
  });

test("CSS load gates even modal construction until the release stylesheet is available", async (t) => {
  const page = await fixture(t);
  let release;
  await page.route(
    "**/forms.css",
    (route) =>
      new Promise((done) => {
        release = async () => {
          await route.fulfill({
            contentType: "text/css",
            body: await readFile(
              new URL(
                "../packages/core/src/website/forms.css",
                import.meta.url,
              ),
              "utf8",
            ),
          });
          done();
        };
      }),
  );
  await page.evaluate(() =>
    window.install([
      {
        key: "overlay",
        presentation: "popup",
        paths: ["*"],
        form: window.form,
      },
    ]),
  );
  await page.waitForFunction(() =>
    Boolean(document.querySelector("fonte-form")),
  );
  assert.equal(await page.locator("dialog").count(), 0);
  assert.equal(await page.locator("fonte-form input").count(), 0);
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 0);
  await release();
  await mounted(page);
});

async function holdOpeningFrames(page) {
  await page.evaluate(() => {
    let id = 0;
    window.openingFrames = new Map();
    window.requestAnimationFrame = (callback) => {
      window.openingFrames.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (frame) => window.openingFrames.delete(frame);
    window.advanceOpeningFrame = () => {
      const [frame, callback] = window.openingFrames.entries().next().value;
      window.openingFrames.delete(frame);
      callback(performance.now());
    };
  });
}

test("overlay opens after a rendering frame while inline readiness is immediate", async (t) => {
  const page = await fixture(t);
  await holdOpeningFrames(page);
  await page.evaluate(() =>
    window.install([
      {
        key: "newsletter",
        presentation: "inline",
        paths: ["*"],
        form: window.form,
      },
      {
        key: "overlay",
        presentation: "popup",
        paths: ["*"],
        form: window.form,
      },
    ]),
  );
  await page.waitForFunction(
    () =>
      window.openingFrames.size === 1 && window.forms.counts().mounted === 1,
    undefined,
    { polling: 20 },
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 1);
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 2);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
  assert.equal(
    await page
      .locator("dialog input[name=email]")
      .evaluate((input) => input.getRootNode().activeElement === input),
    true,
  );
});

for (const framesCompleted of [0, 1]) {
  test(`destroy cancels pending overlay frame after ${framesCompleted} completed frames`, async (t) => {
    const page = await fixture(t);
    await holdOpeningFrames(page);
    await page.evaluate(() =>
      window.install([
        {
          key: "overlay",
          presentation: "popup",
          paths: ["*"],
          form: window.form,
        },
      ]),
    );
    await page.waitForFunction(
      () => window.openingFrames.size === 1,
      undefined,
      { polling: 20 },
    );
    if (framesCompleted)
      await page.evaluate(() => window.advanceOpeningFrame());
    await page.evaluate(() => {
      const stale = window.openingFrames.values().next().value;
      window.forms.destroy();
      document.getElementById("opener").focus();
      stale(performance.now());
    });
    assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
    assert.equal(await page.locator("fonte-form").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
      mounted: 0,
      unavailable: 0,
    });
    assert.equal(
      await page
        .locator("#opener")
        .evaluate((input) => document.activeElement === input),
      true,
    );
  });
}

async function queuedInlineFixture(t) {
  const page = await fixture(t);
  await holdOpeningFrames(page);
  await page.evaluate(() => {
    const keys = ["newsletter", "second", "third"];
    for (const key of keys.slice(1)) {
      const marker = document.createElement("div");
      marker.dataset.fontePlacement = key;
      document.getElementById("content").append(marker);
    }
    window.batchPlacements = keys.map((key) => ({
      key,
      presentation: "inline",
      paths: ["/host"],
      form: window.form,
    }));
    window.install(window.batchPlacements);
    window.batchHosts = keys.map((key) =>
      document.querySelector(`[data-fonte-placement="${key}"] fonte-form`),
    );
  });
  await page.waitForFunction(
    () =>
      window.openingFrames.size === 1 &&
      window.forms.counts().mounted === 1 &&
      window.batchHosts.every(
        (host) => host.shadowRoot.querySelector("link").sheet,
      ),
    undefined,
    { polling: 20 },
  );
  return page;
}

test("additional inline surfaces become ready one per frame with natural layout and host state intact", async (t) => {
  const page = await queuedInlineFixture(t);
  await page.locator("#host-input").fill("Host stays editable");
  const initial = await page.evaluate(() => ({
    counts: window.forms.counts(),
    scroll: window.scrollY,
    height: window.batchHosts
      .find((host) => host.shadowRoot.querySelector("form"))
      .getBoundingClientRect().height,
    observations: window.observations.length,
  }));
  assert.deepEqual(initial.counts, { mounted: 1, unavailable: 2 });
  for (const mountedCount of [2, 3]) {
    await page.evaluate(() => window.advanceOpeningFrame());
    assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
      mounted: mountedCount,
      unavailable: 3 - mountedCount,
    });
    assert.equal(
      await page.locator("#host-input").inputValue(),
      "Host stays editable",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "host-input",
    );
    assert.equal(await page.evaluate(() => window.scrollY), initial.scroll);
  }
  assert.deepEqual(
    await page.evaluate(() =>
      window.batchHosts.map((host) => host.getBoundingClientRect().height),
    ),
    [initial.height, initial.height, initial.height],
  );
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
  assert.equal(
    await page.evaluate(() => window.observations.length),
    initial.observations,
  );
});

test("a settings update before queued inline rendering uses only the current copy and revision", async (t) => {
  const page = await queuedInlineFixture(t);
  await page.evaluate(() => {
    window.batchPlacements = window.batchPlacements.map((placement) => ({
      ...placement,
      form: {
        ...window.form,
        publishedRevision: 2,
        headline: "Updated before render",
      },
    }));
    window.forms.apply(window.settings(window.batchPlacements));
  });
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.batchHosts.filter(
          (host) => host.shadowRoot.querySelector("form") === null,
        ).length,
    ),
    2,
  );
  await page.evaluate(() => window.advanceOpeningFrame());
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.deepEqual(
    await page.evaluate(() =>
      window.batchHosts.map(
        (host) => host.shadowRoot.querySelector("h2").textContent,
      ),
    ),
    ["Updated before render", "Updated before render", "Updated before render"],
  );
  const third = page.locator('[data-fonte-placement="third"] fonte-form');
  await third.locator('input[name="email"]').fill("fixture@example.test");
  await third.getByRole("button", { name: "Subscribe", exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls[0].publishedRevision), 2);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

for (const mode of ["destroy", "disabled settings", "navigation"]) {
  test(`${mode} cancels queued inline rendering and stale frame callbacks cannot restore a surface`, async (t) => {
    const page = await queuedInlineFixture(t);
    await page.evaluate((mode) => {
      window.staleInlineFrame = window.openingFrames.values().next().value;
      if (mode === "destroy") window.forms.destroy();
      else if (mode === "disabled settings") window.forms.apply(null);
      else {
        history.pushState(null, "", "/other");
        window.forms.navigate();
      }
      document.getElementById("host-input").focus();
      window.staleInlineFrame(performance.now());
    }, mode);
    assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
    assert.equal(await page.locator("fonte-form").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
      mounted: 0,
      unavailable: 0,
    });
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "host-input",
    );
    assert.equal(
      await page.evaluate(() =>
        window.batchHosts.every(
          (host) => host.shadowRoot.querySelector("input") === null,
        ),
      ),
      true,
    );
  });
}

test("removing a queued inline marker cancels its view while other surfaces finish and reinsertion rebinds once", async (t) => {
  const page = await queuedInlineFixture(t);
  await page.evaluate(() => {
    window.removedBatchHost = window.batchHosts.find(
      (host) => host.shadowRoot.querySelector("form") === null,
    );
    window.removedBatchMarker = window.removedBatchHost.parentElement;
    window.removedBatchKey = window.removedBatchMarker.dataset.fontePlacement;
    window.removedBatchMarker.remove();
  });
  await page.waitForFunction(
    () => window.removedBatchHost.shadowRoot.querySelector("link") === null,
  );
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 2);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
  assert.equal(
    await page.evaluate(() =>
      window.removedBatchHost.shadowRoot.querySelector("input"),
    ),
    null,
  );
  await page.evaluate(() =>
    document.getElementById("content").append(window.removedBatchMarker),
  );
  await page.waitForFunction(() => window.openingFrames.size === 1, undefined, {
    polling: 20,
  });
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 3);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .querySelector(`[data-fonte-placement="${window.removedBatchKey}"]`)
          .querySelectorAll("fonte-form").length,
    ),
    1,
  );
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

test("a cancelled inline frame cannot consume a newly queued settings generation", async (t) => {
  const page = await queuedInlineFixture(t);
  await page.evaluate(() => {
    window.oldInlineFrame = window.openingFrames.values().next().value;
    window.forms.apply(null);
    window.forms.apply(
      window.settings(
        window.batchPlacements.map((placement) => ({
          ...placement,
          form: { ...window.form, headline: "New generation" },
        })),
      ),
    );
  });
  await page.waitForFunction(() => window.openingFrames.size === 1, undefined, {
    polling: 20,
  });
  await page.evaluate(() => window.oldInlineFrame(performance.now()));
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 0);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 1);
  for (const count of [1, 2, 3]) {
    await page.evaluate(() => window.advanceOpeningFrame());
    assert.equal(
      await page.evaluate(() => window.forms.counts().mounted),
      count,
    );
  }
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
  assert.deepEqual(await page.locator("fonte-form h2").allTextContents(), [
    "New generation",
    "New generation",
    "New generation",
  ]);
});

async function waitingOverlayFixture(t) {
  const page = await queuedInlineFixture(t);
  await page.locator("#host-input").fill("Host stays editable");
  await page.evaluate(() => {
    window.overlayPlacement = {
      key: "overlay",
      presentation: "popup",
      paths: ["/host"],
      form: window.form,
    };
    window.forms.apply(
      window.settings([...window.batchPlacements, window.overlayPlacement]),
    );
  });
  await page.locator("dialog").waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => window.openingFrames.size), 1);
  return page;
}

test("overlay waits for the inline batch and two settling frames before becoming ready", async (t) => {
  const page = await waitingOverlayFixture(t);
  const height = await page.evaluate(
    () =>
      window.batchHosts
        .find((host) => host.shadowRoot.querySelector("form"))
        .getBoundingClientRect().height,
  );
  for (const count of [2, 3]) {
    await page.evaluate(() => window.advanceOpeningFrame());
    assert.equal(
      await page.evaluate(() => window.forms.counts().mounted),
      count,
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => window.openingFrames.size), 1);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "host-input",
    );
  }
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.deepEqual(await page.evaluate(() => window.forms.counts()), {
    mounted: 4,
    unavailable: 0,
  });
  assert.deepEqual(
    await page.evaluate(() =>
      window.batchHosts.map((host) => host.getBoundingClientRect().height),
    ),
    [height, height, height],
  );
  assert.equal(
    await page.locator("#host-input").inputValue(),
    "Host stays editable",
  );
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

test("new inline work before opening restarts the existing two-frame settling period", async (t) => {
  const page = await fixture(t);
  await holdOpeningFrames(page);
  await page.evaluate(() => {
    window.overlayPlacement = {
      key: "overlay",
      presentation: "popup",
      paths: ["/host"],
      form: window.form,
    };
    window.install([window.overlayPlacement]);
  });
  await page.waitForFunction(() => window.openingFrames.size === 1);
  await page.evaluate(() => window.advanceOpeningFrame());
  await page.evaluate(() => {
    const keys = ["newsletter", "second", "third"];
    for (const key of keys.slice(1)) {
      const marker = document.createElement("div");
      marker.dataset.fontePlacement = key;
      document.getElementById("content").append(marker);
    }
    window.batchPlacements = keys.map((key) => ({
      key,
      presentation: "inline",
      paths: ["/host"],
      form: window.form,
    }));
    window.forms.apply(
      window.settings([...window.batchPlacements, window.overlayPlacement]),
    );
  });
  await page.waitForFunction(
    () =>
      window.forms.counts().mounted === 1 && window.openingFrames.size === 2,
  );
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 1);
  for (const count of [2, 3]) {
    await page.evaluate(() => window.advanceOpeningFrame());
    assert.equal(
      await page.evaluate(() => window.forms.counts().mounted),
      count,
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 4);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

for (const mode of ["destroy", "disabled settings", "navigation"]) {
  test(`${mode} removes a waiting overlay without stale opening or inline frames`, async (t) => {
    const page = await waitingOverlayFixture(t);
    await page.evaluate((mode) => {
      const stale = window.openingFrames.values().next().value;
      if (mode === "destroy") window.forms.destroy();
      else if (mode === "disabled settings") window.forms.apply(null);
      else {
        history.pushState(null, "", "/other");
        window.forms.navigate();
      }
      document.getElementById("host-input").focus();
      stale(performance.now());
    }, mode);
    assert.equal(await page.locator("fonte-form").count(), 0);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "host-input",
    );
  });
}

test("removing remaining queued inline markers releases the waiting overlay exactly once", async (t) => {
  const page = await waitingOverlayFixture(t);
  await page.evaluate(() => {
    for (const host of window.batchHosts)
      if (!host.shadowRoot.querySelector("form")) host.parentElement.remove();
  });
  await page.waitForFunction(
    () =>
      window.batchHosts.filter((host) => host.isConnected).length === 1 &&
      window.openingFrames.size === 1,
  );
  for (let frame = 0; frame < 2; frame++)
    await page.evaluate(() => window.advanceOpeningFrame());
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 2);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

test("a replacement generation cannot receive an old waiting overlay callback", async (t) => {
  const page = await waitingOverlayFixture(t);
  await page.evaluate(() => {
    window.oldInlineFrame = window.openingFrames.values().next().value;
    window.forms.apply(null);
    window.forms.apply(
      window.settings(
        [...window.batchPlacements, window.overlayPlacement].map(
          (placement) => ({
            ...placement,
            form: { ...window.form, headline: "Replacement generation" },
          }),
        ),
      ),
    );
  });
  await page.waitForFunction(
    () =>
      window.openingFrames.size === 1 &&
      document.querySelectorAll("fonte-form").length === 4 &&
      [...document.querySelectorAll("fonte-form")].every(
        (host) => host.shadowRoot.querySelector("link").sheet,
      ),
  );
  await page.evaluate(() => window.oldInlineFrame(performance.now()));
  assert.equal(await page.evaluate(() => window.forms.counts().mounted), 0);
  for (const count of [1, 2, 3]) {
    await page.evaluate(() => window.advanceOpeningFrame());
    assert.equal(
      await page.evaluate(() => window.forms.counts().mounted),
      count,
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }
  for (let frame = 0; frame < 2; frame++)
    await page.evaluate(() => window.advanceOpeningFrame());
  assert.deepEqual(
    await page.locator("fonte-form h2").allTextContents(),
    Array(4).fill("Replacement generation"),
  );
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.evaluate(() => window.openingFrames.size), 0);
});

test("captures source-only modal and inline screenshot/trace evidence", async (t) => {
  const page = await fixture(t);
  await page
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.locator("#opener").focus();
  await page.evaluate(() =>
    window.install([
      {
        key: "newsletter",
        presentation: "inline",
        paths: ["*"],
        form: window.form,
      },
      {
        key: "overlay",
        presentation: "slide_in",
        paths: ["*"],
        form: window.form,
      },
    ]),
  );
  await mounted(page, 2);
  await page.screenshot({
    path: `${evidence}/modal-and-inline.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${evidence}/inline.png`, fullPage: true });
  await page
    .context()
    .tracing.stop({ path: `${evidence}/frontend-fixture-trace.zip` });
});
