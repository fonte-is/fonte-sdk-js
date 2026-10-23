import {createSequenceManagementClient,type SequenceManagementClient} from "./operator-sequence-management-client.js";
import { CoreOperatorError, type CoreRequester } from "./operator-core-request.js";
import type { SequenceJsonObject, SequenceReadInput } from "./operator-sequence-types.js";
export interface SequenceExecutionResult {
  kind: "sequence_execution"; operation: "participants" | "inspect" | "enroll" | "control";
  sequence_id: string; data: SequenceJsonObject;
}
export interface SequenceRuntimeClient extends SequenceManagementClient {
  listSequenceParticipants(input: SequenceReadInput): Promise<SequenceExecutionResult>;
  inspectSequenceParticipant(input: SequenceReadInput & { participationId: string }): Promise<SequenceExecutionResult>;
  enrollSequenceEvent(input: SequenceReadInput & { sourceEventId: string }): Promise<SequenceExecutionResult>;
  controlSequenceParticipant(input: SequenceReadInput & { participationId: string; operation: "pause" | "resume" | "stop" }): Promise<SequenceExecutionResult>;
}
export function createSequenceRuntimeClient(request: CoreRequester): SequenceRuntimeClient {
  const path = (input: SequenceReadInput, suffix = "") => `/v1/workspaces/${encodeURIComponent(input.workspace)}/sequences/${encodeURIComponent(input.sequenceId)}/participants${suffix}?environment=${input.environment}`;
  const result = (value: unknown, input: SequenceReadInput, operation: SequenceExecutionResult["operation"], participationId?: string): SequenceExecutionResult => {
    const effect = operation === "enroll" || operation === "control" ? "unknown" : "none";
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(effect);
    const data = value as SequenceJsonObject;
    if (data.environment !== input.environment || typeof data.tenantId !== "string") invalid(effect);
    if(operation === "inspect" || operation === "control") {
      const participant=data.participant as SequenceJsonObject|undefined;
      if(!participant || typeof participant!=="object" || Array.isArray(participant)
        || participant.participationId!==participationId || !["active","completed","exited","failed","stopped"].includes(String(participant.status)))invalid(effect);
    }else if(operation==="enroll"&&(typeof data.participationId!=="string"||typeof data.created!=="boolean"))invalid(effect);
    else if(operation==="participants"&&(!Array.isArray(data.rows)||data.rows.some(row=>!row||typeof row!=="object"||Array.isArray(row)||typeof row.participation_id!=="string")))invalid(effect);
    return { kind: "sequence_execution", operation, sequence_id: input.sequenceId, data };
  };
  return {
    ...createSequenceManagementClient(request),
    async listSequenceParticipants(input) { return result(await request(path(input)), input, "participants"); },
    async inspectSequenceParticipant(input) { return result(await request(path(input, `/${encodeURIComponent(input.participationId)}`)), input, "inspect",input.participationId); },
    async enrollSequenceEvent(input) { return result(await request(path(input), { body: { sourceEventId: input.sourceEventId }, lostResponseEffect: "unknown" }), input, "enroll"); },
    async controlSequenceParticipant(input) { return result(await request(path(input, `/${encodeURIComponent(input.participationId)}/control`),
      { body: { operation: input.operation }, lostResponseEffect: "unknown" }), input, "control",input.participationId); },
  };
}
function invalid(effect: "none"|"unknown"): never { throw new CoreOperatorError("sequence_runtime_response_invalid", null, effect); }
