import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  createFonteMcpServer,
  MCP_FONTE_TOOLS,
} from "../../packages/cli/dist/mcp-sequence-server.js";
import { createAuthenticatedBroadcastProvider } from "../../packages/cli/dist/broadcast-runtime.js";
import { createBroadcastFileStore } from "../../packages/cli/dist/broadcast-file-store.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  reviewRequest,
  ready,
  json,
} from "./broadcast-bg1.mjs";

const proofPath = process.env.PAVED_PROOF_FILE;
const storeDirectory = process.env.PAVED_REQUEST_DIRECTORY;
const counts = {
  selectedWorkspaceReads: 0,
  supplierProviderCalls: 0,
  supplierCreateCalls: 0,
  supplierReadCalls: 0,
  sendCalls: 0,
  draftReadWorkspace: null,
  legacyCanonicalProviderCalls: 0,
  legacyPrepareCalls: 0,
  legacySendCalls: 0,
  legacyOtherProviderCalls: 0,
  quoteConfirmCalls: 0,
  bgReviewPosts: 0,
  catalogReads: 0,
};
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreOrigin,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const neverLegacy = async () => {
  counts.legacyOtherProviderCalls++;
  throw new Error("unexpected_legacy_supplier");
};
const providers = {
  broadcastBg: createAuthenticatedBroadcastProvider({
    configUrl,
    authorize: async () => "synthetic-bg1-prepare-bearer",
    store: createBroadcastFileStore(storeDirectory),
    fetch: async (input, init = {}) => {
      if (String(input) === configUrl) return json(hosted);
      const uri = new URL(String(input));
      assert.equal(uri.origin, coreOrigin);
      if (uri.pathname === "/v1/workspaces") {
        counts.catalogReads++;
        return json({
          workspaces: [
            {
              workspaceId,
              tenantId: "tenant_bg1",
              accountId: "account_bg1",
              slug: scope.workspace,
              workspaceSlug: scope.workspace,
              workspaceCode: scope.workspace,
              displayName: "Synthetic BG-1",
              role: "owner",
              availableEnvironments: [scope.environment],
            },
          ],
        });
      }
      if (uri.pathname.endsWith("/send-plan")) counts.quoteConfirmCalls++;
      assert.equal(
        uri.pathname,
        `/v1/workspaces/${scope.workspace}/broadcast-drafts/${scope.draftId}/broadcast-review`,
      );
      assert.equal(uri.searchParams.get("environment"), scope.environment);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.deepEqual(JSON.parse(init.body), reviewRequest);
      counts.bgReviewPosts++;
      return json(ready);
    },
  }),
  workspaceCatalog: neverLegacy,
  sequence: neverLegacy,
  broadcastDraftLifecycle: async () => ({
    async readBroadcastDraft(input) {
      counts.draftReadWorkspace = input.workspace;
      throw new Error("unexpected_legacy_draft_read");
    },
  }),
  broadcastDraftRevision: neverLegacy,
  broadcastSender: neverLegacy,
  broadcastTargeting: neverLegacy,
  broadcastRenderTest: neverLegacy,
  broadcastSendInstruction: async () => {
    counts.sendCalls++;
    throw new Error("unexpected_legacy_send");
  },
  broadcastRecipientSets: async () => {
    counts.supplierProviderCalls++;
    return {
      async readBroadcastRecipientSet() {
        counts.supplierReadCalls++;
        throw new Error("unexpected_csv_supplier_read");
      },
      async createBroadcastRecipientSet() {
        counts.supplierCreateCalls++;
        throw new Error("unexpected_csv_supplier_create");
      },
    };
  },
  canonicalBroadcast: async () => {
    counts.legacyCanonicalProviderCalls++;
    return {
      async prepare() {
        counts.legacyPrepareCalls++;
        throw new Error("unexpected_legacy_quote");
      },
      async send() {
        counts.legacySendCalls++;
        throw new Error("unexpected_legacy_confirm");
      },
      async read() {
        throw new Error("unexpected_legacy_send_read");
      },
    };
  },
  productionDrafts: neverLegacy,
  campaignMetadata: neverLegacy,
  segmentMetadata: neverLegacy,
  broadcastHtmlPreparation: neverLegacy,
};
const readinessReader = {
  inspectHost: async () => ({ initialized: true, tools: MCP_FONTE_TOOLS }),
  readSession: async () => ({
    status: { state: "ready", serverCheck: "not_checked" },
    storageAvailable: true,
  }),
  listWorkspaces: async () => [
    { slug: "legacy-selected-workspace", name: "Legacy selected workspace" },
  ],
  readSelectedWorkspace: async () => {
    counts.selectedWorkspaceReads++;
    return "legacy-selected-workspace";
  },
};
process.once("SIGTERM", () => {
  if (proofPath) writeFileSync(proofPath, JSON.stringify(counts));
  process.exit(0);
});
await createFonteMcpServer(providers, readinessReader).connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);
