import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchRepositoryPush,
  REPOSITORY_PUSH_EVENT_VERSION,
} from "../packages/cli/dist/repository-push-trigger.js";

const repositoryUrl = "https://git.example.test/org/repo";
const source = "a".repeat(40);

function makeDependencies(options = {}) {
  const calls = [];
  const qualifications = [];
  const event = {
    schemaVersion: REPOSITORY_PUSH_EVENT_VERSION,
    deliveryId: "delivery-123",
    repository: { url: `${repositoryUrl}.git` },
    ref: "refs/heads/main",
    before: "0".repeat(40),
    after: source,
    receivedAt: "2026-09-24T12:00:00.000Z",
  };
  const dependencies = {
    cwd: "/work/repo",
    expectedRepositoryUrl: repositoryUrl,
    authenticator: {
      async authenticate(delivery) {
        if (options.authenticationFails) throw new Error("unverified");
        return delivery;
      },
    },
    runner: {
      async run(command, args, cwd) {
        calls.push({ command, args: [...args], cwd });
        if (command === "git") {
          return {
            exitCode: 0,
            stdout: options.origin ?? `${repositoryUrl}.git\n`,
            stderr: "",
          };
        }
        if (command === "fonte") {
          return { exitCode: 0, stdout: "{\"status\":\"VERIFIED\"}\n", stderr: "" };
        }
        throw new Error(`unexpected command: ${command}`);
      },
    },
    async qualifyCandidate(received) {
      qualifications.push(received);
      return { exitCode: 0, stdout: "{\"status\":\"QUALIFIED\"}\n", stderr: "" };
    },
  };
  return { event, calls, qualifications, dependencies };
}

test("authenticated main push verifies repository and delegates its exact SHA to fonte release", async () => {
  const { event, calls, dependencies } = makeDependencies();
  const result = await dispatchRepositoryPush(event, dependencies);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    { command: "git", args: ["remote", "get-url", "origin"], cwd: "/work/repo" },
    { command: "fonte", args: ["release", "--source", source], cwd: "/work/repo" },
  ]);
});

test("candidate branch push passes the unchanged event to FON-749 without invoking release", async () => {
  const { event, calls, qualifications, dependencies } = makeDependencies();
  event.ref = "refs/heads/feature/cache-proof";
  const result = await dispatchRepositoryPush(event, dependencies);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(qualifications, [event]);
  assert.equal(calls.some((call) => call.command === "fonte"), false);
});

test("unverified and wrong-repository deliveries stop before release", async () => {
  const unverified = makeDependencies({ authenticationFails: true });
  const unverifiedResult = await dispatchRepositoryPush(unverified.event, unverified.dependencies);
  assert.equal(unverifiedResult.exitCode, 3);
  assert.deepEqual(JSON.parse(unverifiedResult.stdout), {
    status: "BLOCKED",
    reason: "event_authentication_failed",
  });
  assert.equal(unverified.calls.length, 0);

  const wrongRepository = makeDependencies();
  wrongRepository.event.repository.url = "https://git.example.test/other/repo";
  const wrongRepositoryResult = await dispatchRepositoryPush(
    wrongRepository.event,
    wrongRepository.dependencies,
  );
  assert.equal(wrongRepositoryResult.exitCode, 3);
  assert.deepEqual(JSON.parse(wrongRepositoryResult.stdout), {
    status: "BLOCKED",
    reason: "repository_mismatch",
  });
  assert.equal(wrongRepository.calls.length, 0);
});

test("invalid source SHA and checkout origin mismatch stop before runtime invocation", async () => {
  const invalid = makeDependencies();
  invalid.event.after = "local-only";
  const invalidResult = await dispatchRepositoryPush(invalid.event, invalid.dependencies);
  assert.equal(invalidResult.exitCode, 3);
  assert.equal(invalid.calls.length, 0);

  const mismatchedOrigin = makeDependencies({ origin: "https://git.example.test/other/repo.git\n" });
  const originResult = await dispatchRepositoryPush(mismatchedOrigin.event, mismatchedOrigin.dependencies);
  assert.equal(originResult.exitCode, 3);
  assert.deepEqual(JSON.parse(originResult.stdout), {
    status: "BLOCKED",
    reason: "repository_mismatch",
  });
  assert.equal(mismatchedOrigin.calls.some((call) => call.command === "fonte"), false);
});
