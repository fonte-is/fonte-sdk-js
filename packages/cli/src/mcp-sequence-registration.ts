import type { McpServer } from "@modelcontextprotocol/server";

import {
  createSequenceToolHandlers,
  MCP_SEQUENCE_TOOLS,
  type SequenceMcpClientProvider,
} from "./mcp-sequence-tools.js";
import {
  activateSequenceInputSchema,
  activationOutputSchema,
  createSequenceInputSchema,
  diffOutputSchema,
  diffSequenceInputSchema,
  exportOutputSchema,
  exportSequenceInputSchema,
  listSequencesInputSchema,
  listSequencesOutputSchema,
  readSequenceInputSchema,
  sequenceOutputSchema,
  simulateSequenceInputSchema,
  simulationOutputSchema,
  updateSequenceInputSchema,
  validateSequenceInputSchema,
  validationOutputSchema,
} from "./mcp-sequence-types.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const draftMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpSequenceTools(
  server: McpServer,
  provider: SequenceMcpClientProvider,
): void {
  const handlers = createSequenceToolHandlers(provider);
  server.registerTool(
    MCP_SEQUENCE_TOOLS[0],
    {
      title: "List Sequence drafts",
      description:
        "Lists Core-authorized Sequence drafts for one workspace and environment.",
      inputSchema: listSequencesInputSchema,
      outputSchema: listSequencesOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.list(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[1],
    {
      title: "Read Sequence draft",
      description:
        "Reads one exact Core-owned Sequence draft without activating it.",
      inputSchema: readSequenceInputSchema,
      outputSchema: sequenceOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.read(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[2],
    {
      title: "Create Sequence draft",
      description:
        "Creates one Core-owned Sequence draft with a caller-owned operation key. It cannot activate, enroll, or send.",
      inputSchema: createSequenceInputSchema,
      outputSchema: sequenceOutputSchema,
      annotations: draftMutation,
    },
    async (input) => result(await handlers.create(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[3],
    {
      title: "Update Sequence draft",
      description:
        "Revision-checks and updates one Core-owned Sequence draft. It cannot alter running participants or send.",
      inputSchema: updateSequenceInputSchema,
      outputSchema: sequenceOutputSchema,
      annotations: draftMutation,
    },
    async (input) => result(await handlers.update(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[4],
    {
      title: "Validate Sequence definition",
      description:
        "Asks Core to validate a definition without saving, activating, enrolling, or sending it.",
      inputSchema: validateSequenceInputSchema,
      outputSchema: validationOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.validate(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[5],
    {
      title: "Compare Sequence definition",
      description:
        "Asks Core for the semantic difference between one saved draft revision and a proposed definition.",
      inputSchema: diffSequenceInputSchema,
      outputSchema: diffOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.diff(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[6],
    {
      title: "Export Sequence definition",
      description:
        "Exports one exact Core-owned Sequence definition without triggering delivery.",
      inputSchema: exportSequenceInputSchema,
      outputSchema: exportOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.export(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[7],
    {
      title: "Simulate Sequence timing",
      description:
        "Returns Core's authoring-only timing preview. It never requests a delivery outcome.",
      inputSchema: simulateSequenceInputSchema,
      outputSchema: simulationOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.simulate(input)),
  );
  server.registerTool(
    MCP_SEQUENCE_TOOLS[8],
    {
      title: "Activate Sequence version",
      description:
        "Freezes one exact Core draft revision and its sender/scope/render references. It cannot enroll, select recipients, send, or run delivery.",
      inputSchema: activateSequenceInputSchema,
      outputSchema: activationOutputSchema,
      annotations: draftMutation,
    },
    async (input) => result(await handlers.activate(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
