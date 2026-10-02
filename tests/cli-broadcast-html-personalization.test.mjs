import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  broadcastHtmlPreparationOutputSchema,
  broadcastHtmlSourceReportSchema,
} from "../packages/cli/dist/mcp-broadcast-html-preparation-types.js";
import {
  createBroadcastHtmlPrepareToolHandler,
  createBroadcastHtmlReviseToolHandler,
} from "../packages/cli/dist/mcp-broadcast-html-preparation-tools.js";
import { prepareBroadcastHtmlSource } from "../packages/cli/dist/operator-broadcast-html-source.js";
import {
  clientWith,
  draftId,
  lifecycle,
  mcpPrepareInput,
  mcpReviseInput,
  render,
  revision,
  workspace,
} from "./fixtures/broadcast-html-preparation-values.mjs";

const schema = "fonte-core-personalization-v1";
const sourceFile = "/synthetic/broadcast.html";
const providerHtml =
  '<html><body style="font-family:Arial"><p>' +
  "{{{FIRST_NAME}}} / {{{FIRST_NAME|there}}} / {{{FIRST_NAME}}}</p>" +
  '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Leave</a>' +
  "<p>{{{postal_address}}}</p></body></html>";
const nativeHtml = providerHtml
  .replaceAll("{{{FIRST_NAME}}}", "{{ first_name }}")
  .replaceAll("{{{FIRST_NAME|there}}}", '{{ first_name | default: "there" }}')
  .replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "{{{unsubscribe_url}}}");

test("known Resend first-name forms stay dynamic with exact conversion receipts", async () => {
  const result = await source(providerHtml);
  assert.equal(result.html, nativeHtml);
  assert.equal(result.report.source_bytes, Buffer.byteLength(providerHtml));
  assert.equal(result.report.source_sha256, digest(providerHtml));
  assert.equal(result.report.prepared_bytes, Buffer.byteLength(nativeHtml));
  assert.equal(result.report.prepared_sha256, digest(nativeHtml));
  assert.equal(result.report.recipient_slot_schema_version, schema);
  assert.deepEqual(result.report.blockers, []);
  assert.deepEqual(result.report.unsupported_tokens, []);
  assert.deepEqual(result.report.conversions, [
    conversion("{{{RESEND_UNSUBSCRIBE_URL}}}", "{{{unsubscribe_url}}}", 1),
    conversion("{{{FIRST_NAME}}}", "{{ first_name }}", 2),
    conversion(
      "{{{FIRST_NAME|there}}}",
      '{{ first_name | default: "there" }}',
      1,
    ),
  ]);
  assert.deepEqual(
    result.report.supported_slots.filter(({ occurrences }) => occurrences > 0),
    [
      { token: "{{{unsubscribe_url}}}", occurrences: 1 },
      { token: "{{{postal_address}}}", occurrences: 1 },
      { token: "{{ first_name }}", occurrences: 2 },
      { token: '{{ first_name | default: "there" }}', occurrences: 1 },
    ],
  );
  broadcastHtmlSourceReportSchema.parse(result.report);
});

test("normalized input is byte-stable on a repeated intake", async () => {
  const result = await source(nativeHtml);
  assert.equal(result.html, nativeHtml);
  assert.equal(result.report.source_sha256, result.report.prepared_sha256);
  assert.deepEqual(result.report.conversions, []);
  assert.deepEqual(result.report.blockers, []);
  assert.equal(result.report.recipient_slot_schema_version, schema);
});

test("unknown provider expressions remain unchanged and refused", async () => {
  for (const token of [
    "{{{UNKNOWN_FIELD}}}",
    "{{{FIRST_NAME|friend}}}",
    "{{{FIRST_NAME|there|upper}}}",
    "{{{contact.first_name|Friend}}}",
  ]) {
    const result = await source(
      providerHtml.replace("{{{FIRST_NAME}}}", token),
    );
    assert.ok(result.html.includes(token));
    assert.deepEqual(result.report.unsupported_tokens, [token]);
    assert.ok(
      result.report.blockers.includes("broadcast_recipient_slot_unsupported"),
    );
    assert.ok(
      result.report.conversions.every(({ source }) => source !== token),
    );
  }
});

test("an explicit legacy fallback cannot literalize a known dynamic form", async () => {
  const result = await source(providerHtml, {
    literalFallbacks: { "{{{FIRST_NAME|there}}}": "replacement copy" },
  });
  assert.equal(result.html, nativeHtml);
  assert.ok(
    result.report.blockers.includes("broadcast_literal_fallback_unused"),
  );
  assert.ok(
    result.report.conversions.every(({ kind }) => kind !== "literal_fallback"),
  );
});

test("normalized file creates, reads and renders the supplied stable draft", async () => {
  const calls = [];
  const handler = createBroadcastHtmlPrepareToolHandler(async () =>
    flowClient(1, calls),
  );
  const result = await handler(mcpPrepareInput());
  assert.equal(result.outcome, "completed");
  assert.equal(result.source.recipient_slot_schema_version, schema);
  assert.equal(result.save.draft_id, draftId);
  assert.equal(result.readback.draft.html_body, nativeHtml);
  assert.deepEqual(calls, [
    [
      "create",
      {
        workspace,
        draftId,
        title: "Synthetic draft",
        subject: "Synthetic subject",
        preheader: "Synthetic preheader",
        activeSource: "html",
        composerBody: null,
        htmlBody: nativeHtml,
      },
    ],
    ["read", { workspace, draftId }],
    ["render", { workspace, draftId, revision: 1 }],
  ]);
  broadcastHtmlPreparationOutputSchema.parse(result);
});

test("normalized correction keeps draft, base revision, operation and render flow", async () => {
  const calls = [];
  const handler = createBroadcastHtmlReviseToolHandler(async () =>
    flowClient(2, calls),
  );
  const result = await handler({
    ...mcpReviseInput(),
    source_file: sourceFile,
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.save.draft_id, draftId);
  assert.equal(result.save.revision, 2);
  assert.equal(result.save.draft.sender_profile_id, "sender_preserved");
  assert.equal(result.save.draft.source_campaign_id, draftId);
  assert.deepEqual(result.save.draft.recipient_selection, {
    to: { kind: "everyone" },
    except: [{ kind: "system", systemId: draftId }],
  });
  assert.deepEqual(calls, [
    [
      "revise",
      {
        workspace,
        draftId,
        baseRevision: 1,
        operationId: "correct-html-v2",
        changes: { activeSource: "html", htmlBody: nativeHtml },
      },
    ],
    ["read", { workspace, draftId }],
    ["render", { workspace, draftId, revision: 2 }],
  ]);
  broadcastHtmlPreparationOutputSchema.parse(result);
});

test("unknown source stops both flows before authentication or Core", async () => {
  let providers = 0;
  const unavailable = async () => {
    providers += 1;
    assert.fail("unexpected Core client");
  };
  const client = clientWith({
    html: "<p>{{{UNKNOWN_FIELD}}}</p>",
    lifecycle: unavailable,
    revision: unavailable,
    render: unavailable,
  });
  const prepare = createBroadcastHtmlPrepareToolHandler(async () => client);
  const revise = createBroadcastHtmlReviseToolHandler(async () => client);
  for (const result of [
    await prepare(mcpPrepareInput()),
    await revise({ ...mcpReviseInput(), source_file: sourceFile }),
  ]) {
    assert.equal(result.outcome, "blocked");
    assert.equal(result.stage, "intake");
    assert.equal(result.core_effect, "none");
    assert.ok(
      result.source.blockers.includes("broadcast_recipient_slot_unsupported"),
    );
    broadcastHtmlPreparationOutputSchema.parse(result);
  }
  assert.equal(providers, 0);
});

async function source(html, overrides = {}) {
  return prepareBroadcastHtmlSource(
    {
      sourceFile,
      referenceFile: null,
      requireSubject: true,
      subject: "Synthetic subject",
      preheader: "Synthetic preheader",
      postalAddressLiteral: null,
      literalFallbacks: {},
      ...overrides,
    },
    async (file) => ({ path: file, bytes: new TextEncoder().encode(html) }),
  );
}

function conversion(source, replacement, occurrences) {
  return { kind: "provider_token", source, replacement, occurrences };
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function flowClient(version, calls) {
  return clientWith({
    html: providerHtml,
    lifecycle: async () => ({
      createBroadcastDraft: async (input) => {
        calls.push(["create", input]);
        return lifecycle("applied", version, nativeHtml);
      },
      readBroadcastDraft: async (input) => {
        calls.push(["read", input]);
        return lifecycle(null, version, nativeHtml);
      },
    }),
    revision: async () => ({
      reviseBroadcastDraft: async (input) => {
        calls.push(["revise", input]);
        return revision(version, nativeHtml);
      },
    }),
    render: async () => ({
      renderBroadcastDraft: async (input) => {
        calls.push(["render", input]);
        const receipt = render(version, nativeHtml);
        receipt.render_proof.recipient_slot_schema_version = schema;
        return receipt;
      },
    }),
  });
}
