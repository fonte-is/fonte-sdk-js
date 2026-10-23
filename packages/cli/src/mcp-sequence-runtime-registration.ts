import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SequenceMcpClientProvider } from "./mcp-sequence-tools.js";
import type { SequenceRuntimeClient } from "./operator-sequence-runtime-client.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";

export const MCP_SEQUENCE_RUNTIME_TOOLS = ["fonte_list_sequence_participants", "fonte_inspect_sequence_participant", "fonte_enroll_sequence_event", "fonte_control_sequence_participant"] as const;
export function registerMcpSequenceRuntimeTools(server: McpServer, provider: SequenceMcpClientProvider) {
  const base = { workspace: z.string().min(2).max(63), environment: z.enum(["sandbox", "production"]), sequence_id: z.string().min(1).max(200) };
  const schemas = [z.object(base).strict(), z.object({ ...base, participation_id: z.string().min(1).max(200) }).strict(),
    z.object({ ...base, source_event_id: z.string().min(1).max(200) }).strict(),
    z.object({ ...base, participation_id: z.string().min(1).max(200), operation: z.enum(["pause", "resume", "stop"]) }).strict()] as const;
  MCP_SEQUENCE_RUNTIME_TOOLS.forEach((name, index) => server.registerTool(name, {
    title: ["List Sequence participants", "Explain actual Sequence participant", "Enroll a canonical event", "Control Sequence participant"][index]!,
    description: index === 2 ? "Enrolls one existing authoritative business episode through Core. Replays retain its pinned version. This can start activated work."
      : index === 3 ? "Pauses, resumes or stops one actual participant through current Core authority. A stop cannot recall an already performed action."
      : "Reads actual persisted Sequence progress, reasons and canonical action evidence.",
    inputSchema: schemas[index]!, annotations: { readOnlyHint: index < 2, destructiveHint: false, idempotentHint: true, openWorldHint: index === 2 },
  }, async (raw: unknown) => {
    const value = schemas[index]!.parse(raw);
    try {
      const client = await provider() as Partial<SequenceRuntimeClient>;
      const input = { workspace: value.workspace, environment: value.environment, sequenceId: value.sequence_id };
      let result;
      if (index === 0 && client.listSequenceParticipants) result = await client.listSequenceParticipants(input);
      else if (index === 1 && client.inspectSequenceParticipant && "participation_id" in value) result = await client.inspectSequenceParticipant({ ...input, participationId: String((value as Record<string,unknown>).participation_id) });
      else if (index === 2 && client.enrollSequenceEvent && "source_event_id" in value) result = await client.enrollSequenceEvent({ ...input, sourceEventId: String(value.source_event_id) });
      else if (index === 3 && client.controlSequenceParticipant && "operation" in value) result = await client.controlSequenceParticipant({ ...input, participationId: String((value as Record<string,unknown>).participation_id), operation: value.operation as "pause" | "resume" | "stop" });
      else throw new TypeError("Sequence runtime client unavailable");
      return envelope({ outcome: "completed", result });
    } catch (error) { return envelope(sequenceMcpFailure(error)); }
  }));
}
function envelope(value: object) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value }; }
