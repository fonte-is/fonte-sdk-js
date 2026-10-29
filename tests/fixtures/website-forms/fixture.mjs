import { createWebsiteForms } from "/dist/website/forms.js";
import { startWebsiteRuntime } from "/dist/website/runtime.js";

// Frontend fixture only: this transport does not create durable subscriptions.
window.calls = [];
window.intents = [];
window.plan = [];
window.deferred = [];
window.violations = [];
window.observations = [];
window.documentScans = 0;
window.observerCallbacks = 0;
document.addEventListener("securitypolicyviolation", (event) => {
  window.violations.push(event.violatedDirective);
});
const NativeObserver = window.MutationObserver;
window.MutationObserver = class extends NativeObserver {
  constructor(callback) {
    super((records, observer) => {
      if (observer.fixtureOwned) window.observerCallbacks++;
      callback(records, observer);
    });
  }
  observe(node, options) {
    // Playwright also installs observers when it waits for selectors. Record
    // only the document childList observer used by the renderer fixture.
    this.fixtureOwned =
      node === document.documentElement &&
      options.childList === true &&
      options.subtree === true &&
      !options.attributes &&
      !options.characterData;
    if (this.fixtureOwned) window.observations.push(options);
    return super.observe(node, options);
  }
};
const queryDocument = document.querySelectorAll.bind(document);
document.querySelectorAll = (selector) => {
  window.documentScans++;
  return queryDocument(selector);
};
for (const name of ["localStorage", "sessionStorage"]) {
  Object.defineProperty(window, name, {
    get() {
      throw new Error("Disabled storage");
    },
  });
}
window.form = {
  publicId: "00000000-0000-4000-8000-000000000001",
  publishedRevision: 1,
  headline: "Updates <script>are text</script>",
  description: "Published description",
  submitLabel: "Subscribe",
  successMessage: "Configured completed success",
  firstNameEnabled: true,
  confirmation: "double_opt_in",
  scopeLabel: "Updates from the fixture",
};
window.settings = (
  placements = [
    {
      key: "newsletter",
      presentation: "inline",
      paths: ["*"],
      form: window.form,
    },
  ],
) => ({
  schema: "fonte.website.v1",
  siteId: "site_0123456789abcdef",
  revision: 1,
  enabled: true,
  origins: [location.origin],
  collection: { mode: "off", policy: null },
  placements: structuredClone(placements),
});
window.install = (placements, css = "/forms.css") => {
  window.forms = createWebsiteForms({
    stylesheetUrl: new URL(css, location.origin).href,
    submit(intent) {
      window.intents.push(intent);
      window.calls.push(structuredClone(intent));
      const next = window.plan.shift() ?? {
        kind: "completed",
        submissionId: "frontend-only",
      };
      if (next === "defer")
        return new Promise((resolve, reject) =>
          window.deferred.push({ resolve, reject }),
        );
      if (next === "lost")
        return Promise.reject(new Error("Ambiguous response"));
      return Promise.resolve(next);
    },
  });
  window.forms.apply(window.settings(placements));
};
window.startDeniedRuntime = (consent = "denied") => {
  window.runtime = startWebsiteRuntime({
    siteId: "site_0123456789abcdef",
    runtimeVersion: "forms-fixture",
    settingsUrl: `${location.origin}/settings`,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ...window.settings(),
          collection: {
            mode: "opt_in",
            policy: {
              version: "fixture",
              expiresAt: null,
              storage: "memory",
              routes: ["*"],
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    onSettings: (value) => window.forms.apply(value),
    onNavigation: () => window.forms.navigate(),
    getFormCounts: () => window.forms.counts(),
  });
  window.runtime.setConsent(consent);
};
window.fixtureReady = true;
if (location.pathname === "/early") {
  window.install();
  window.earlyCounts = window.forms.counts();
  window.earlyReadyState = document.readyState;
}
