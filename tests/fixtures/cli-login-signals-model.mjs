const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "synthetic-client",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const scenario = process.env.FONTE_SIGNAL_TEST_SCENARIO;
const phases = [];
let stored = null;
let removals = 0;
let releaseCommit;

function report(kind, extra = {}) {
  process.send({
    kind,
    sigintListeners: process.listenerCount("SIGINT"),
    sigtermListeners: process.listenerCount("SIGTERM"),
    ...extra,
  });
}

export function createOperatingSystemLoginStore() {
  return {
    read: async () => stored,
    write: async (value) => {
      stored = value;
      if (scenario === "commit") {
        // Model pending native I/O: a bare Promise does not keep Node alive.
        const pendingCommit = setInterval(() => {}, 60_000);
        try {
          await new Promise((resolve) => {
            releaseCommit = resolve;
            report("committing");
          });
        } finally {
          clearInterval(pendingCommit);
        }
      }
    },
    remove: async () => {
      stored = null;
      removals++;
    },
  };
}

export async function withLoginLock(operation, signal) {
  const aborted = () => {
    report("aborted");
    releaseCommit?.();
  };
  signal.addEventListener("abort", aborted, { once: true });
  try {
    return await operation();
  } finally {
    signal.removeEventListener("abort", aborted);
  }
}

export const productionDependencies = {
  prepare: async () => {
    throw new Error("unexpected legacy OAuth");
  },
  openBrowser: async () => true,
  listenForOAuthCallback: async () => ({
    callback: Promise.resolve(
      new URL(
        `${hosted.redirectUri}?code=synthetic-code&state=synthetic-state`,
      ),
    ),
    transition: (phase) => phases.push(phase),
    finish: (phase) => phases.push(phase),
    close() {},
    boundPort: 0,
  }),
};

export async function prepareOpenIdAuthorization() {
  return {
    state: "synthetic-state",
    authorizationUrl: new URL("https://identity.example.test/authorize"),
    exchange: async () => ({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      expiresInSeconds: 3600,
      subject: "synthetic-subject",
      scopes: ["email"],
    }),
  };
}

export async function refreshOpenIdAuthorization() {
  throw new Error("unexpected refresh");
}

export async function runProgram(argv, dependencies) {
  if (argv[0] === "doctor" || argv[0] === "--help")
    return await waitForSignal();
  try {
    await dependencies.operator.authorize(hosted, dependencies.operator.signal);
    if (scenario === "after-login") return await waitForSignal();
    report("unexpected_success");
    process.disconnect();
    return { exitCode: 0, stdout: "unexpected success\n", stderr: "" };
  } catch (error) {
    report("cancelled_result", {
      reason: error.reason,
      stored: stored !== null,
      removals,
      phases,
      credentialPersisted: dependencies.auth.session.credentialPersisted(),
    });
    process.disconnect();
    return { exitCode: 3, stdout: "", stderr: "Synthetic login cancelled.\n" };
  }
}

function waitForSignal() {
  report("ordinary_idle");
  // Keep the modeled command alive so the parent can test default termination.
  return new Promise(() => setInterval(() => {}, 60_000));
}
