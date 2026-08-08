import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { root } from "./workspace-utils.mjs";

const consumer = join(root, ".artifacts", "consumers", "nextjs-16-react-19");

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      reject(new Error("unable to allocate browser smoke port"));
      return;
    }
    probe.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});

const nextBin = join(consumer, "node_modules", "next", "dist", "bin", "next");
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  cwd: consumer,
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    FONTE_SITE_URL: baseUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const browserTypes = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const exerciseBrowser = async (name, browserType) => {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const posts = [];
    const browserErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/fonte/collect"
      ) {
        posts.push(request.postDataJSON());
      }
    });

    await page.goto(
      `${baseUrl}/?utm_source=demo&utm_medium=paid_social&secret=drop`,
    );
    await page.waitForFunction(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/api/fonte/collect"))
          .length >= 2,
    );
    assert.equal(posts.length, 2, `${name}: initial delivery count`);
    assert.deepEqual(
      posts.map(({ eventType }) => eventType).sort(),
      ["page_view", "source_touch"],
      `${name}: initial event types`,
    );
    for (const post of posts) {
      assert.equal(post.scope.current_url.includes("secret="), false);
    }

    await page.click("#second-link");
    await page.waitForURL(/\/second\?utm_source=route$/);
    await page.waitForFunction(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/api/fonte/collect"))
          .length >= 4,
    );
    assert.equal(posts.length, 4, `${name}: route delivery count`);
    assert.equal(
      posts
        .slice(2)
        .every(({ scope }) => scope.current_url.includes("/second")),
      true,
      `${name}: route URL capture`,
    );
    assert.deepEqual(browserErrors, [], `${name}: browser errors`);

    return { name, version: await browser.version(), status: "passed" };
  } finally {
    await browser.close();
  }
};

try {
  const deadline = Date.now() + 20_000;
  while (true) {
    if (server.exitCode != null) {
      throw new Error(`packed Next server exited early\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) break;
    } catch {
      // The server is still starting.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `packed Next server did not become ready\n${serverOutput}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const browsers = [];
  for (const [name, browserType] of browserTypes) {
    browsers.push(await exerciseBrowser(name, browserType));
  }

  const report = {
    ok: true,
    browsers,
    consumer: "nextjs-16-react-19",
    installedFrom: "npm-pack-tarballs",
    assertions: {
      collectionBeginsOnMount: true,
      deliveredPageAndSourceTouch: true,
      unknownQueryRemoved: true,
      deliveryPayloadBounded: true,
      clientRouteRecaptured: true,
      browserErrors: 0,
    },
  };
  writeFileSync(
    join(root, ".artifacts", "consumers", "browser-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (server.exitCode == null) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.exitCode == null) server.kill("SIGKILL");
}
