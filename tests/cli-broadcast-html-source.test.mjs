import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BROADCAST_HTML_MAX_BYTES,
  BroadcastLocalFileError,
  readBroadcastLocalFile,
} from "../packages/cli/dist/operator-broadcast-html-file.js";
import { prepareBroadcastHtmlSource } from "../packages/cli/dist/operator-broadcast-html-source.js";

const sourcePath = "/synthetic/source.html";
const referencePath = "/synthetic/reference.png";
const providerHtml =
  "<!doctype html><!--$--><html><body " +
  'style="font-family:Arial,sans-serif"><p>Hi ' +
  "{{{contact.first_name|Friend}}}</p>" +
  '<img src="https://assets.example.test/hero.png">' +
  '<a data-id="__react-email-column" ' +
  'href="{{{RESEND_UNSUBSCRIBE_URL}}}">Leave</a>' +
  "<p>1 Example Street</p><!--/$--></body></html>";

test("source intake preserves bytes and reports only explicit conversions", async () => {
  const source = await prepareBroadcastHtmlSource(
    sourceInput({
      postalAddressLiteral: "1 Example Street",
      literalFallbacks: { "{{{contact.first_name|Friend}}}": "Friend" },
    }),
    reader({
      [sourcePath]: bytes(providerHtml),
      [referencePath]: bytes("reference bytes"),
    }),
  );

  assert.equal(source.report.source_bytes, bytes(providerHtml).byteLength);
  assert.equal(source.report.source_sha256, digest(bytes(providerHtml)));
  assert.equal(
    source.report.reference.sha256,
    digest(bytes("reference bytes")),
  );
  assert.equal(
    source.report.visual_verification,
    "reference_bound_not_compared",
  );
  assert.deepEqual(source.report.blockers, []);
  assert.deepEqual(source.report.unsupported_tokens, [
    "{{{contact.first_name|Friend}}}",
  ]);
  assert.match(source.html, /Hi Friend/);
  assert.match(source.html, /\{\{\{unsubscribe_url\}\}\}/);
  assert.match(source.html, /\{\{\{postal_address\}\}\}/);
  assert.doesNotMatch(source.html, /RESEND_|data-id|<!--\$-->/);
  assert.equal(source.report.prepared_sha256, digest(bytes(source.html)));
  assert.deepEqual(
    [...new Set(source.report.conversions.map(({ kind }) => kind))].sort(),
    ["literal_fallback", "provider_artifact", "provider_token"],
  );
});

test("unsupported personalization blocks until its exact fallback is selected", async () => {
  const blocked = await prepareBroadcastHtmlSource(
    sourceInput({
      literalFallbacks: {},
    }),
    reader({
      [sourcePath]: bytes(providerHtml),
      [referencePath]: bytes("reference"),
    }),
  );
  assert.deepEqual(blocked.report.unsupported_tokens, [
    "{{{contact.first_name|Friend}}}",
  ]);
  assert.ok(
    blocked.report.blockers.includes("broadcast_recipient_slot_unsupported"),
  );

  const unused = await prepareBroadcastHtmlSource(
    sourceInput({
      literalFallbacks: { "{{{contact.first_name|Other}}}": "Other" },
    }),
    reader({
      [sourcePath]: bytes(providerHtml),
      [referencePath]: bytes("reference"),
    }),
  );
  assert.ok(
    unused.report.blockers.includes("broadcast_literal_fallback_unused"),
  );
});

test("missing metadata, typography, reference and assets stay explicit", async () => {
  const html = '<html><body><img src="./hero.png">Body</body></html>';
  const source = await prepareBroadcastHtmlSource(
    {
      ...sourceInput({ subject: null, referenceFile: null }),
      sourceFile: sourcePath,
      postalAddressLiteral: "Missing address",
    },
    reader({ [sourcePath]: bytes(html) }),
  );
  assert.ok(source.report.blockers.includes("broadcast_subject_missing"));
  assert.ok(
    source.report.blockers.includes("broadcast_asset_dependency_unresolved"),
  );
  assert.ok(
    source.report.blockers.includes(
      "broadcast_postal_address_literal_not_found",
    ),
  );
  assert.deepEqual(source.report.asset_dependencies, ["./hero.png"]);
  assert.equal(source.report.font_status, "unverified");
  assert.deepEqual(source.report.warnings, [
    "font_dependency_unverified",
    "visual_reference_missing",
  ]);
  assert.equal(
    source.report.visual_verification,
    "unverified_missing_reference",
  );
});

test("local file reader rejects oversized, invalid and indirect sources", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-html-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalid = path.join(directory, "invalid.html");
  const oversized = path.join(directory, "oversized.html");
  const linked = path.join(directory, "linked.html");
  await writeFile(invalid, Uint8Array.from([0xff]));
  await writeFile(oversized, new Uint8Array(BROADCAST_HTML_MAX_BYTES + 1));
  await symlink(invalid, linked);

  await assert.rejects(
    prepareBroadcastHtmlSource(
      {
        ...sourceInput({ referenceFile: null }),
        sourceFile: invalid,
      },
      readBroadcastLocalFile,
    ),
    (error) => error.reason === "broadcast_source_invalid_utf8",
  );
  await assert.rejects(
    readBroadcastLocalFile(oversized, BROADCAST_HTML_MAX_BYTES),
    (error) =>
      error instanceof BroadcastLocalFileError &&
      error.reason === "broadcast_source_file_too_large",
  );
  await assert.rejects(
    readBroadcastLocalFile(linked, BROADCAST_HTML_MAX_BYTES),
    (error) => error.reason === "broadcast_source_not_regular_file",
  );
});

function sourceInput(overrides = {}) {
  return {
    sourceFile: sourcePath,
    referenceFile: referencePath,
    requireSubject: true,
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    postalAddressLiteral: null,
    literalFallbacks: {},
    ...overrides,
  };
}

function reader(files) {
  return async (file, maximumBytes) => {
    const value = files[file];
    if (!value)
      throw new BroadcastLocalFileError("broadcast_source_file_missing");
    if (value.byteLength > maximumBytes) {
      throw new BroadcastLocalFileError("broadcast_source_file_too_large");
    }
    return { path: file, bytes: value };
  };
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
