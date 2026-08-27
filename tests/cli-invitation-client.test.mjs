import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreOperatorError,
  createCoreOperatorClient,
} from "../packages/cli/dist/operator-client.js";

const invitationToken = "A".repeat(43);
const invitationId = "10000000-0000-4000-8000-000000000178";
const grantId = "20000000-0000-4000-8000-000000000178";
const workspace = {
  workspaceId: "workspace_synthetic_fonte",
  workspaceSlug: "fonte",
  workspaceCode: "FONTE01",
  displayName: "Fonte Synthetic",
  environment: "sandbox",
};
const invitation = {
  invitationId,
  workspace,
  intendedIdentity: {
    supabaseSubject: "subject_synthetic_invitee",
    email: "invitee@example.test",
  },
  role: "operator",
  status: "pending",
  issuedBySupabaseSubject: "subject_synthetic_owner",
  createdAt: "2026-08-27T09:00:00.000Z",
  expiresAt: "2026-08-28T09:00:00.000Z",
  revokedAt: null,
  claimedAt: null,
};

test("official client completes owner create, response-loss claim replay, and relogin context", async () => {
  const requests = [];
  let claimCommitted = false;
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    const bearer = init.headers.authorization;
    requests.push({ url, init, bearer });
    if (url.pathname.endsWith("/invitations")) {
      assert.equal(url.pathname, "/v1/workspaces/fonte/invitations");
      assert.equal(url.search, "?environment=sandbox");
      assert.equal(bearer, "Bearer owner.synthetic.bearer");
      assert.deepEqual(JSON.parse(init.body), {
        intendedSupabaseSubject: "subject_synthetic_invitee",
        intendedEmail: "invitee@example.test",
        role: "operator",
        expiresAt: "2026-08-28T09:00:00.000Z",
      });
      return json(
        {
          schemaVersion: "workspace-invitation.v0",
          invitation,
          invitationToken,
        },
        201,
      );
    }
    if (url.pathname === "/v1/workspace-invitations/claim") {
      assert.equal(url.search, "");
      assert.deepEqual(JSON.parse(init.body), {
        invitationToken,
        workspaceSlug: "fonte",
        environment: "sandbox",
      });
      if (!claimCommitted) {
        assert.equal(bearer, "Bearer invitee.synthetic.bearer");
        claimCommitted = true;
        throw new Error("response lost after commit");
      }
      assert.equal(bearer, "Bearer invitee.relogin.bearer");
      return json(claimReceipt(true), 200);
    }
    assert.equal(url.pathname, "/v1/workspaces");
    assert.equal(url.search, "");
    assert.equal(bearer, "Bearer invitee.relogin.bearer");
    return json({ workspaces: [workspaceContext()] });
  };

  const owner = client("owner.synthetic.bearer", fetcher);
  const created = await owner.createWorkspaceInvitation({
    workspace: "fonte",
    environment: "sandbox",
    intendedSupabaseSubject: "subject_synthetic_invitee",
    intendedEmail: " Invitee@Example.Test ",
    role: "operator",
    expiresAt: "2026-08-28T09:00:00.000Z",
  });
  assert.equal(created.invitation_token, invitationToken);
  assert.equal(created.invitation.status, "pending");

  const invitee = client("invitee.synthetic.bearer", fetcher);
  await assert.rejects(
    invitee.claimWorkspaceInvitation(claimInput()),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_api_unavailable" &&
      error.statusCode === null &&
      error.coreEffect === "unknown",
  );

  const relogin = client("invitee.relogin.bearer", fetcher);
  const replay = await relogin.claimWorkspaceInvitation(claimInput());
  assert.equal(replay.replayed, true);
  assert.equal(replay.grant_created, false);
  assert.equal(replay.grant_id, grantId);
  assert.equal("invitation_token" in replay, false);

  const contexts = await relogin.listWorkspaceContexts();
  assert.deepEqual(contexts, [
    {
      workspace_id: workspace.workspaceId,
      account_id: "account_synthetic_fonte",
      workspace_slug: workspace.workspaceSlug,
      workspace_code: workspace.workspaceCode,
      display_name: workspace.displayName,
      role: "operator",
      available_environments: ["sandbox"],
    },
  ]);
  assert.equal(requests.length, 4);
});

test("wrong, expired, revoked, and unavailable claims preserve exact Core boundaries", async () => {
  const boundaries = [
    ["workspace_invitation_identity_mismatch", 403, "none"],
    ["workspace_invitation_scope_mismatch", 409, "none"],
    ["workspace_invitation_expired", 410, "none"],
    ["workspace_invitation_revoked", 410, "none"],
    ["workspace_invitation_unavailable", 404, "none"],
    ["workspace_invitation_identity_provider_unavailable", 503, "unknown"],
  ];
  for (const [reason, statusCode, coreEffect] of boundaries) {
    const connector = client("invitee.synthetic.bearer", async () =>
      json({ error: reason }, statusCode),
    );
    await assert.rejects(
      connector.claimWorkspaceInvitation(claimInput()),
      (error) =>
        error instanceof CoreOperatorError &&
        error.reason === reason &&
        error.statusCode === statusCode &&
        error.coreEffect === coreEffect,
      reason,
    );
  }
});

test("invalid inputs and receipt drift fail before authority is widened", async () => {
  let requests = 0;
  const connector = client("invitee.synthetic.bearer", async () => {
    requests += 1;
    if (requests === 1)
      return json({ ...claimReceipt(false), invitationToken });
    return json({
      ...claimReceipt(false),
      workspace: { ...workspace, workspaceSlug: "synthetic-other" },
    });
  });
  await assert.rejects(
    connector.claimWorkspaceInvitation({
      ...claimInput(),
      workspace: "wrong/slug",
    }),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "workspace_invitation_request_invalid" &&
      error.coreEffect === "none",
  );
  assert.equal(requests, 0);
  await assert.rejects(
    connector.claimWorkspaceInvitation(claimInput()),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_operator_receipt_invalid" &&
      error.coreEffect === "unknown",
  );
  assert.equal(requests, 1);
  await assert.rejects(
    connector.claimWorkspaceInvitation(claimInput()),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_operator_receipt_invalid" &&
      error.coreEffect === "unknown",
  );
  assert.equal(requests, 2);
});

function client(bearer, fetcher) {
  return createCoreOperatorClient({
    coreApiBaseUrl: "https://api.example.test",
    bearer,
    fetch: fetcher,
  });
}

function claimInput() {
  return {
    invitationToken,
    workspace: "fonte",
    environment: "sandbox",
  };
}

function claimReceipt(replayed) {
  return {
    schemaVersion: "workspace-invitation.v0",
    invitationId,
    workspace,
    role: "operator",
    status: "claimed",
    grantId,
    grantCreated: !replayed,
    replayed,
    claimedAt: "2026-08-27T09:01:00.000Z",
  };
}

function workspaceContext() {
  return {
    workspaceId: workspace.workspaceId,
    tenantId: workspace.workspaceId,
    accountId: "account_synthetic_fonte",
    slug: workspace.workspaceSlug,
    workspaceSlug: workspace.workspaceSlug,
    workspaceCode: workspace.workspaceCode,
    displayName: workspace.displayName,
    role: "operator",
    availableEnvironments: ["sandbox"],
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
