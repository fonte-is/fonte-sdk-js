export const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
export const coreUrl = "http://127.0.0.1:43112";
export const workspace = "northstar";
export const sequenceId = "welcome-sequence";
export const bearer = "synthetic.header.signature";

export const definition = {
  schema: "sequence_definition.v1",
  title: "Welcome",
  entry: { kind: "subscription_episode" },
  reentry: "once",
  steps: [
    {
      id: "welcome",
      kind: "send",
      subject: "Welcome to Northstar",
      message: {
        kind: "inline_email",
        html: "<p>Welcome to Northstar</p>",
        text: "Welcome to Northstar",
      },
    },
    { id: "wait-two-days", kind: "wait_duration", durationSeconds: 172800 },
    {
      id: "followup",
      kind: "send",
      subject: "A quick follow-up",
      message: {
        kind: "inline_email",
        html: "<p>A quick follow-up</p>",
        text: "A quick follow-up",
      },
    },
  ],
};

export function scopeArguments() {
  return ["--workspace", workspace, "--environment", "sandbox", "--json"];
}

export function createArguments() {
  return [
    "sequence",
    "create",
    ...scopeArguments(),
    "--sequence-id",
    sequenceId,
    "--operation-key",
    "create-welcome",
    "--definition",
    JSON.stringify(definition),
  ];
}

export function updateArguments() {
  return [
    "sequence",
    "update",
    ...scopeArguments(),
    "--sequence-id",
    sequenceId,
    "--expected-revision",
    "1",
    "--operation-key",
    "update-welcome",
    "--definition",
    JSON.stringify({ ...definition, title: "A warmer welcome" }),
  ];
}

export function simulateArguments() {
  return [
    "sequence",
    "simulate",
    ...scopeArguments(),
    "--sequence-id",
    sequenceId,
    "--entered-at-ms",
    "0",
    "--assumed-accepted-at-ms",
    JSON.stringify({ welcome: 0, followup: 172800000 }),
  ];
}

export function activationBinding() {
  return {
    senderId: "sender-sequence-welcome",
    scope: { kind: "general_marketing" },
    messageRenderReferences: [
      { stepId: "welcome", renderReference: "render-welcome" },
      { stepId: "followup", renderReference: "render-followup" },
    ],
  };
}

export function activateArguments() {
  return [
    "sequence",
    "activate",
    ...scopeArguments(),
    "--sequence-id",
    sequenceId,
    "--expected-revision",
    "2",
    "--operation-key",
    "activate-welcome",
    "--binding",
    JSON.stringify(activationBinding()),
  ];
}

export function sequenceRoute(request) {
  const collection = "/v1/workspaces/northstar/sequences?environment=sandbox";
  const item =
    "/v1/workspaces/northstar/sequences/welcome-sequence?environment=sandbox";
  if (request.method === "GET" && request.path === collection)
    return json(bound({ rows: [sequence(1)] }));
  if (request.method === "POST" && request.path === collection) {
    return json(bound({ outcome: "applied", sequence: sequence(1) }), 201);
  }
  if (request.method === "GET" && request.path === item)
    return json(bound({ sequence: sequence(1) }));
  if (request.method === "PUT" && request.path === item) {
    return json(bound({ outcome: "applied", sequence: sequence(2) }));
  }
  if (
    request.method === "POST" &&
    request.path ===
      `${collection.replace("?environment=sandbox", "/validate?environment=sandbox")}`
  ) {
    return json(bound({ valid: true, definition, plan: plan() }));
  }
  if (
    request.method === "POST" &&
    request.path ===
      `${item.replace("?environment=sandbox", "/diff?environment=sandbox")}`
  ) {
    return json(
      bound({
        sequenceId,
        baseRevision: 1,
        currentRevision: 2,
        diff: { changed: true, changes: [{ kind: "title_changed" }] },
      }),
    );
  }
  if (
    request.method === "POST" &&
    request.path ===
      `${item.replace("?environment=sandbox", "/activate?environment=sandbox")}`
  ) {
    return json(
      bound({
        outcome: "activated",
        sequenceId,
        draftRevision: 2,
        activatedVersion: activatedVersion(),
      }),
      201,
    );
  }
  if (
    request.method === "GET" &&
    request.path ===
      `${item.replace("?environment=sandbox", "/export?environment=sandbox")}`
  ) {
    return json(bound({ sequenceId, revision: 2, definition }));
  }
  if (
    request.method === "POST" &&
    request.path ===
      `${item.replace("?environment=sandbox", "/simulate?environment=sandbox")}`
  ) {
    return json(
      bound({
        sequenceId,
        revision: 2,
        simulation: {
          enteredAtMs: 0,
          steps: [],
          nextDeliveryOutcomeRequiredForStepId: "welcome",
        },
        delivery: "not_requested_by_authoring_preview",
      }),
    );
  }
  throw new Error(
    `unexpected synthetic request: ${request.method} ${request.path}`,
  );
}

export function sequence(revision) {
  return {
    sequenceId,
    revision,
    definition,
    plan: plan(),
    createdAt: "2026-09-19T08:00:00.000Z",
    updatedAt: "2026-09-19T08:01:00.000Z",
  };
}

export function plan() {
  return {
    title: definition.title,
    entry: "subscription_episode",
    reentry: "once",
    steps: [
      {
        stepId: "welcome",
        kind: "send",
        content: "complete",
        subject: "Welcome to Northstar",
      },
      {
        stepId: "wait-two-days",
        kind: "wait_duration",
        durationSeconds: 172800,
      },
      {
        stepId: "followup",
        kind: "send",
        content: "complete",
        subject: "A quick follow-up",
      },
    ],
  };
}

export function activatedVersion() {
  const activatedAt = "2026-09-19T08:02:00.000Z";
  return {
    activatedVersionId: "10000000-0000-4000-8000-000000000611",
    version: 1,
    draftRevision: 2,
    definition,
    binding: activationBinding(),
    activatedAt,
    activatedAtMs: Date.parse(activatedAt),
    current: true,
  };
}

export function bound(value) {
  return { tenantId: "workspace-synthetic", environment: "sandbox", ...value };
}

export function dependencies(fetch) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000610",
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch,
      authorize: async () => bearer,
      sleep: async () => undefined,
    },
  };
}

export function withoutOption(argv, name) {
  const index = argv.indexOf(name);
  return [...argv.slice(0, index), ...argv.slice(index + 2)];
}

export function hostedConfig() {
  return {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: "https://auth.example.test",
    clientId: "fonte-cli-sequence-v1",
    coreApiBaseUrl: coreUrl,
    redirectUri: "http://127.0.0.1:49671/callback",
    scopes: ["email"],
  };
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
