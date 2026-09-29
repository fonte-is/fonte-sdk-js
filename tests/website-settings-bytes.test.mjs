import assert from "node:assert/strict";
import { test } from "node:test";
import { settings, siteId } from "./fixtures/website/settings.mjs";

const NativeEncoder = TextEncoder;
const reference = new NativeEncoder();
const settingsUrl = new URL(
  "../packages/core/dist/website/settings.js",
  import.meta.url,
);
let instance = 0;
async function withParser(mode, operation) {
  const calls = { constructors: 0, encode: 0, into: [], buffers: new Set() };
  globalThis.TextEncoder = class extends NativeEncoder {
    constructor() {
      super();
      calls.constructors++;
      if (mode === "fallback")
        Object.defineProperty(this, "encodeInto", { value: undefined });
    }
    encode(value) {
      calls.encode++;
      return super.encode(value);
    }
    encodeInto(value, destination) {
      const result = super.encodeInto(value, destination);
      calls.buffers.add(destination);
      calls.into.push({ ...result, units: value.length });
      return result;
    }
  };
  try {
    const module = await import(`${settingsUrl}?byte-case=${++instance}`);
    return await operation(module, calls);
  } finally {
    globalThis.TextEncoder = NativeEncoder;
  }
}
function outcome(parse, value) {
  try {
    return { value: parse(value, siteId) };
  } catch (error) {
    assert.equal(error.code, "invalid_website_configuration");
    return { error: error.field };
  }
}

test("settings UTF-8 outcomes match native encode across scalar, surrogate and field boundaries", async () => {
  const cases = [];
  for (const [field, cap] of [
    ["headline", 512],
    ["description", 8192],
    ["submitLabel", 512],
    ["successMessage", 8192],
    ["scopeLabel", 512],
  ]) {
    for (const token of [
      "a",
      "é",
      "ह",
      "💡",
      "e\u0301",
      "\ud800",
      "\udc00",
      "\ud800\udc00",
      "\ud800a\udc00",
      "\n",
    ]) {
      const tokenBytes = reference.encode(token).length;
      const count = Math.floor(cap / tokenBytes);
      for (const delta of [-1, 0, 1]) {
        const input = settings();
        input.placements[0].form[field] = token.repeat(count + delta);
        cases.push(input);
      }
      const input = settings();
      input.placements[0].form[field] =
        token.repeat(count) + "a".repeat(cap % tokenBytes);
      cases.push(input);
    }
  }
  let seed = 0x5970828;
  for (let index = 0; index < 128; index++) {
    const units = [];
    for (let j = 0; j < 160; j++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      units.push(seed & 0xffff);
    }
    const input = settings();
    input.placements[0].form.headline = String.fromCharCode(...units);
    cases.push(input);
  }
  const expected = await withParser("fallback", ({ parseSiteSettings }) =>
    cases.map((input) => outcome(parseSiteSettings, input)),
  );
  await withParser("native", ({ parseSiteSettings }, calls) => {
    assert.deepEqual(
      cases.map((input) => outcome(parseSiteSettings, input)),
      expected,
    );
    assert.equal(calls.encode, 0);
    assert.equal(calls.constructors, 1);
    assert.equal(calls.buffers.size, 1);
  });
});

test("partial UTF-8 reads reject oversized copy without allocating an unbounded encoded array", async () => {
  const cases = [];
  for (let prefix = 256 * 1024 - 4; prefix <= 256 * 1024 + 4; prefix++)
    for (const suffix of ["é", "ह", "💡", "\ud800", "\udc00"])
      cases.push("a".repeat(prefix) + suffix);
  cases.push("💡".repeat(256 * 1024));
  const expected = await withParser("fallback", ({ parseSiteSettings }) =>
    cases.map((value) => {
      const input = settings();
      input.placements[0].form.headline = value;
      return outcome(parseSiteSettings, input);
    }),
  );
  await withParser(
    "native",
    ({ parseSiteSettings, MAX_SETTINGS_BYTES }, calls) => {
      const actual = cases.map((value) => {
        const input = settings();
        input.placements[0].form.headline = value;
        return outcome(parseSiteSettings, input);
      });
      assert.deepEqual(actual, expected);
      assert(actual.every((value) => value.error === "form.headline"));
      assert(calls.into.some((value) => value.read < value.units));
      assert.equal(calls.encode, 0);
      assert.equal(calls.buffers.size, 1);
      assert.equal([...calls.buffers][0].byteLength, MAX_SETTINGS_BYTES + 4);
    },
  );
});

function aggregate(bytes) {
  const input = settings();
  const form = input.placements[0].form;
  Object.assign(form, {
    headline: "h".repeat(512),
    submitLabel: "b".repeat(512),
    scopeLabel: "s".repeat(512),
    description: "d".repeat(8192),
    successMessage: "m".repeat(8192),
  });
  input.placements = Array.from({ length: 10 }, (_, i) => ({
    ...input.placements[0],
    key: `p${i}`,
    paths: Array(32).fill("/" + "a".repeat(199)),
    form: { ...form },
  }));
  input.collection.policy.campaignValues = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map(
      (key) => [key, Array(64).fill("a".repeat(100))],
    ),
  );
  let remove = reference.encode(JSON.stringify(input)).length - bytes;
  for (const placement of input.placements) {
    const count = Math.min(remove, placement.form.description.length);
    placement.form.description = placement.form.description.slice(count);
    remove -= count;
  }
  assert.equal(remove, 0);
  assert.equal(reference.encode(JSON.stringify(input)).length, bytes);
  return input;
}
test("aggregate byte boundary and a reused buffer preserve exact settings outcomes", async () => {
  const inputs = [
    aggregate(262143),
    aggregate(262144),
    aggregate(262145),
    settings(),
  ];
  const expected = await withParser("fallback", ({ parseSiteSettings }) =>
    inputs.map((input) => outcome(parseSiteSettings, input)),
  );
  assert.equal(expected[0].error, undefined);
  assert.equal(expected[1].error, undefined);
  assert.equal(expected[2].error, "settings.bytes");
  await withParser("native", ({ parseSiteSettings }, calls) => {
    assert.deepEqual(
      inputs.map((input) => outcome(parseSiteSettings, input)),
      expected,
    );
    assert.equal(calls.encode, 0);
    assert.equal(calls.buffers.size, 1);
    assert.equal(calls.constructors, 1);
  });
});

test("older encoders retain native encode fallback and public error fields", async () => {
  await withParser("fallback", ({ parseSiteSettings }, calls) => {
    assert.equal(
      parseSiteSettings(settings(), siteId).placements[0].form.headline,
      "Updates",
    );
    const input = settings();
    input.placements[0].form.headline = "é".repeat(257);
    assert.equal(outcome(parseSiteSettings, input).error, "form.headline");
    assert(calls.encode > 0);
    assert.equal(calls.into.length, 0);
    assert.equal(calls.buffers.size, 0);
    assert.equal(calls.constructors, 1);
  });
});
