# Fonte no-prompt patch

Upstream crate: `secret-service` 5.1.0.

Published crate SHA-256: `9a62d7f86047af0077255a29494136b9aaaf697c76ff70b8e49cded4e2623c14`.

The only Fonte source change adds `Collection::create_item_no_prompt`. It uses
the existing encrypted-session `CreateItem` call but returns `Error::Prompt`
when the service supplies a prompt path; it never calls `exec_prompt`.
