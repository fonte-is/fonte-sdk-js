import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { CoreOperatorError } from "../../packages/cli/dist/operator-core-request.js";
import {
  createFonteMcpServer,
  MCP_FONTE_TOOLS,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000751";
const senderId = "sender-synthetic-primary";
const purposeId = "purpose-synthetic-primary";
const csvPath = process.env.PAVED_CSV_FILE;
const proofPath = process.env.PAVED_PROOF_FILE;
const counts = {
  selectedWorkspaceReads: 0,
  supplierProviderCalls: 0,
  supplierCreateCalls: 0,
  supplierReadCalls: 0,
  sendCalls: 0,
  draftReadWorkspace: null,
};

const draft = {
  draft_id: draftId,
  title: "Synthetic draft",
  sender_profile_id: senderId,
  reply_to: null,
  audience_kind: "recipient_expression",
  audience_contact_import_batch_id: null,
  recipient_expression: { include: [], exclude: [] },
  recipient_selection: null,
  communication_purpose_id: purposeId,
  subscription_name: null,
  subject: "Synthetic subject",
  preheader: null,
  text_body: "Synthetic body",
  active_source: "composer",
  composer_body: "Synthetic body",
  html_body: null,
  created_at: "2026-09-24T10:00:00.000Z",
  updated_at: "2026-09-24T10:00:00.000Z",
};

const providers = {
  workspaceCatalog: async () => ({
    async listWorkspaces() {
      return [
        {
          slug: "other-workspace",
          name: "Other Workspace",
          role: "owner",
          available_environments: ["production"],
        },
        {
          slug: workspace,
          name: "Northstar",
          role: "owner",
          available_environments: ["production"],
        },
      ];
    },
  }),
  sequence: async () => ({}),
  broadcastDraftLifecycle: async () => ({
    async readBroadcastDraft(input) {
      counts.draftReadWorkspace = input.workspace;
      return {
        kind: "broadcast_draft",
        outcome: null,
        draft_id: draftId,
        revision: 1,
        draft: structuredClone(draft),
      };
    },
  }),
  broadcastDraftRevision: async () => ({}),
  broadcastSender: async () => ({
    async listBroadcastSenders() {
      return {
        kind: "broadcast_sender_catalog",
        sender_profiles: [
          {
            sender_profile_id: senderId,
            name: "Synthetic Sender",
            email: "sender@example.test",
            default_reply_to: "reply@example.test",
          },
        ],
      };
    },
    async updateBroadcastSender() {
      throw new Error("unexpected_sender_update");
    },
  }),
  broadcastTargeting: async () => ({
    async updateBroadcastTargeting() {
      throw new Error("unexpected_targeting_update");
    },
  }),
  broadcastRenderTest: async () => ({
    async renderBroadcastDraft() {
      throw new Error("unexpected_render");
    },
  }),
  broadcastSendInstruction: async () => {
    counts.sendCalls += 1;
    throw new Error("unexpected_send");
  },
  broadcastRecipientSets: async () => {
    counts.supplierProviderCalls += 1;
    return {
      async readBroadcastRecipientSet(input) {
        counts.supplierReadCalls += 1;
        if (counts.supplierCreateCalls === 0) {
          throw new CoreOperatorError(
            "broadcast_recipient_set_not_found",
            404,
            "none",
          );
        }
        return {
          kind: "broadcast_recipient_set",
          one_time_set_id: input.setId,
          draft_id: input.draftId,
          status: "pending",
          operation_status: "pending",
          contact_import_batch_id: null,
          created_at: "2026-09-24T10:00:00.000Z",
          population_effect: "broadcast_only_not_everyone",
        };
      },
      async createBroadcastRecipientSet(input) {
        counts.supplierCreateCalls += 1;
        if (input.csvFilePath !== csvPath) {
          throw new Error("unexpected_csv_path");
        }
        const bytes = readFileSync(input.csvFilePath);
        return {
          recipient_set: {
            kind: "broadcast_recipient_set",
            one_time_set_id: input.setId,
            draft_id: input.draftId,
            status: "pending",
            operation_status: "pending",
            contact_import_batch_id: null,
            created_at: "2026-09-24T10:00:00.000Z",
            population_effect: "broadcast_only_not_everyone",
          },
          source: {
            file_name: "synthetic-audience.csv",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            byte_length: bytes.byteLength,
            row_count: 1,
          },
        };
      },
    };
  },
  productionDrafts: async () => ({
    async listProductionAudienceOptions() {
      return {
        kind: "broadcast_audience_options",
        communication_purposes: [
          { communication_purpose_id: purposeId, label: "Marketing" },
        ],
        sources: [],
      };
    },
  }),
  campaignMetadata: async () => ({}),
  segmentMetadata: async () => ({}),
  broadcastHtmlPreparation: async () => ({}),
};

const readinessReader = {
  async inspectHost() {
    return { initialized: true, tools: MCP_FONTE_TOOLS };
  },
  async readSession() {
    return {
      status: { state: "ready", serverCheck: "not_checked" },
      storageAvailable: true,
    };
  },
  async listWorkspaces() {
    return [
      { slug: "other-workspace", name: "Other Workspace" },
      { slug: workspace, name: "Northstar" },
    ];
  },
  async readSelectedWorkspace() {
    counts.selectedWorkspaceReads += 1;
    return workspace;
  },
};

const server = createFonteMcpServer(providers, readinessReader);
process.once("SIGTERM", () => {
  if (proofPath) writeFileSync(proofPath, JSON.stringify(counts), "utf8");
  process.exit(0);
});
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);
