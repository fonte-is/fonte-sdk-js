These are frontend browser fixtures for FON-822. The injected submission port
returns synthetic receipts and never calls Core, creates Contacts, persists
entered values, or sends email. Fixture values use `.test` addresses only.

The HTTP test server applies strict CSP without `unsafe-inline` or `unsafe-eval`.
Both host and Fonte styles load externally. Storage getters throw. The same
native form renderer is exercised in inline, popup and slide-in presentation.
Instrumentation records aggregate document scans and observer callbacks only.

Run after the Core build:

```sh
node --test tests/website-forms.test.mjs
```

The suite uses Playwright's installed Chromium, falling back to the installed
headless Chrome channel when no Playwright browser cache exists. It writes the
browser/profile receipt, screenshots and Playwright trace to
`/private/tmp/fon822-website-forms-evidence/`. These are source-only browser
evidence, not proof of durable acceptance, production CDN delivery or performance
on a customer website. The full UW-1 measurements remain owned by FON-828.
