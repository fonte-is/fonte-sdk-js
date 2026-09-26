import { build, version as bundlerVersion } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const fixture = args.includes("--fixture");
const argument = (key, fallback) => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
if (
  args.some(
    (value) =>
      !["--fixture", "--cdn-origin", "--api-origin", "--out-dir"].includes(
        value,
      ) &&
      !args.some(
        (key, index) =>
          ["--cdn-origin", "--api-origin", "--out-dir"].includes(key) &&
          args[index + 1] === value,
      ),
  )
) {
  throw new Error("unknown website build argument");
}
function origin(key, production) {
  const value = argument(key, production);
  if (!fixture && value !== production)
    throw new Error("production destinations are fixed");
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (fixture &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error("invalid declared fixture origin");
  }
  return value;
}
const cdnOrigin = origin("--cdn-origin", "https://cdn.fonte.is");
const apiOrigin = origin("--api-origin", "https://api.fonte.is");
const output = path.resolve(root, argument("--out-dir", ".artifacts/website"));
if (!output.startsWith(path.join(root, ".artifacts") + path.sep))
  throw new Error("website artifacts must stay under .artifacts");
const css = await readFile(
  path.join(root, "packages/core/src/website/forms.css"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compile = (release) =>
  build({
    absWorkingDir: root,
    entryPoints: ["packages/core/src/website/entry.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    metafile: true,
    define: {
      __FONTE_WEBSITE_CDN_ORIGIN__: JSON.stringify(cdnOrigin),
      __FONTE_WEBSITE_API_ORIGIN__: JSON.stringify(apiOrigin),
      __FONTE_WEBSITE_RELEASE__: JSON.stringify(release),
    },
  });
// The release identity hashes the unbound IIFE + CSS. Final asset hashes are
// recorded separately, avoiding a self-referential hash in its own CSS URL.
const unbound = await compile("0".repeat(64));
const releaseDigest = hash(
  Buffer.concat([unbound.outputFiles[0].contents, css]),
);
const built = await compile(releaseDigest);
const js = built.outputFiles[0].contents;
if (
  Object.keys(built.metafile.inputs).some((name) =>
    /(?:node_modules\/react|packages\/(?:react|nextjs|cli)\/)/.test(name),
  )
) {
  throw new Error("framework/server code entered the plain browser artifact");
}
await rm(output, { recursive: true, force: true });
const release = path.join(output, "website", releaseDigest);
await mkdir(release, { recursive: true });
await writeFile(path.join(output, "v1.js"), js);
await writeFile(path.join(release, "v1.js"), js);
await writeFile(path.join(release, "forms.css"), css);
const asset = (name, bytes, contentType, immutable) => ({
  path: name,
  sha256: hash(bytes),
  bytes: bytes.byteLength,
  gzipBytes: gzipSync(bytes).byteLength,
  brotliBytes: brotliCompressSync(bytes).byteLength,
  headers: {
    "Content-Type": contentType,
    "Cache-Control": immutable
      ? "public,max-age=31536000,immutable"
      : "no-cache,max-age=0,must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    ETag: `"sha256-${hash(bytes)}"`,
  },
});
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const manifest = {
  schema: "fonte.website.artifact.v1",
  releaseDigest,
  sourceRevision,
  fixture,
  bundler: { name: "esbuild", version: bundlerVersion },
  cdnOrigin,
  apiOrigin,
  releaseIdentity: {
    unboundJsSha256: hash(unbound.outputFiles[0].contents),
    cssSha256: hash(css),
  },
  assets: [
    asset("v1.js", js, "application/javascript", false),
    asset(`website/${releaseDigest}/v1.js`, js, "application/javascript", true),
    asset(`website/${releaseDigest}/forms.css`, css, "text/css", true),
  ],
  inputs: Object.fromEntries(
    await Promise.all(
      Object.keys(built.metafile.inputs)
        .sort()
        .map(async (name) => [
          name,
          hash(await readFile(path.join(root, name))),
        ]),
    ),
  ),
};
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    { output, releaseDigest, sourceRevision, fixture, assets: manifest.assets },
    null,
    2,
  ),
);
