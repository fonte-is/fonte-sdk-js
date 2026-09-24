# Fonte SDK JS Repo Rules

## SDK Boundary

- This repository collects evidence. It does not decide attribution, legal
  status, economic finality, or billability.
- Do not add business authority, tenant config storage, or export logic here.
- The SDK must be safe to run on customer sites and should assume the network is
  hostile.
- Keep the public API small and stable. Avoid analytics-platform sprawl.
- Browser state is convenience, not authority.
- Customer work may inform product requirements, but customer identifiers must
  not appear in reusable product artifacts. Do not use real customer, client,
  campaign, product, domain, account, email, file path, project, preset, tenant,
  ad account, or provider-object names in docs, examples, SDK snippets, tests,
  fixtures, seed data, screenshots, commit messages, PR descriptions, sample
  payloads, or agent instructions.
- If a real customer issue inspires a test or fixture, rewrite it as a
  synthetic scenario that preserves only the technical shape of the issue.
  Reusable examples must use synthetic entities such as `demo_store`,
  `Northstar Outfitters`, `Bluebird Coffee`, `Acme Learning`, `Atlas Supply`,
  `premium_plan`, `starter_bundle`, `annual_membership`, `example.com`,
  `demo.fonte.dev`, and `shop.example.test`.
