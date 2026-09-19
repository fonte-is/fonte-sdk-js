import {
  sequenceMcpFailure,
  type SequenceMcpFailure,
} from "./mcp-sequence-failure.js";
import {
  createSequenceInputSchema,
  diffSequenceInputSchema,
  exportSequenceInputSchema,
  listSequencesInputSchema,
  readSequenceInputSchema,
  simulateSequenceInputSchema,
  updateSequenceInputSchema,
  validateSequenceInputSchema,
} from "./mcp-sequence-types.js";
import type { SequenceAuthoringClient } from "./operator-sequence-client.js";
import type {
  SequenceDiffResult,
  SequenceDraftResult,
  SequenceExportResult,
  SequenceSimulationResult,
  SequenceValidationResult,
} from "./operator-sequence-types.js";

export const MCP_SEQUENCE_TOOLS = [
  "fonte_list_sequences",
  "fonte_read_sequence",
  "fonte_create_sequence",
  "fonte_update_sequence",
  "fonte_validate_sequence",
  "fonte_diff_sequence",
  "fonte_export_sequence",
  "fonte_simulate_sequence",
] as const;

export type SequenceMcpClient = Pick<
  SequenceAuthoringClient,
  | "listSequences"
  | "readSequence"
  | "createSequence"
  | "updateSequence"
  | "validateSequence"
  | "diffSequence"
  | "exportSequence"
  | "simulateSequence"
>;
export type SequenceMcpClientProvider = () => Promise<SequenceMcpClient>;

interface SequenceToolHandlers {
  list(
    input: unknown,
  ): Promise<SequenceToolResult<"sequences", readonly SequenceDraftResult[]>>;
  read(
    input: unknown,
  ): Promise<SequenceToolResult<"sequence", SequenceDraftResult>>;
  create(
    input: unknown,
  ): Promise<SequenceToolResult<"sequence", SequenceDraftResult>>;
  update(
    input: unknown,
  ): Promise<SequenceToolResult<"sequence", SequenceDraftResult>>;
  validate(
    input: unknown,
  ): Promise<SequenceToolResult<"validation", SequenceValidationResult>>;
  diff(input: unknown): Promise<SequenceToolResult<"diff", SequenceDiffResult>>;
  export(
    input: unknown,
  ): Promise<SequenceToolResult<"export", SequenceExportResult>>;
  simulate(
    input: unknown,
  ): Promise<SequenceToolResult<"simulation", SequenceSimulationResult>>;
}

type SequenceToolResult<Key extends string, Value> =
  | ({
      readonly outcome: "completed";
      readonly reason: null;
      readonly status_code: null;
      readonly core_effect: "none";
    } & Record<Key, Value>)
  | (SequenceMcpFailure & Record<Key, null>);

/**
 * The direct handlers make the closed Core mapping testable without treating
 * the MCP transport as an authority or client implementation.
 */
export function createSequenceToolHandlers(
  provider: SequenceMcpClientProvider,
): SequenceToolHandlers {
  return {
    async list(input) {
      const value = listSequencesInputSchema.parse(input);
      return execute("sequences", () =>
        provider().then(
          async (client) => (await client.listSequences(value)).sequences,
        ),
      );
    },
    async read(input) {
      const value = readSequenceInputSchema.parse(input);
      return execute("sequence", () =>
        provider().then((client) =>
          client.readSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
          }),
        ),
      );
    },
    async create(input) {
      const value = createSequenceInputSchema.parse(input);
      return execute("sequence", () =>
        provider().then((client) =>
          client.createSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
            operationKey: value.operation_key,
            definition: value.definition,
          }),
        ),
      );
    },
    async update(input) {
      const value = updateSequenceInputSchema.parse(input);
      return execute("sequence", () =>
        provider().then((client) =>
          client.updateSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
            expectedRevision: value.expected_revision,
            operationKey: value.operation_key,
            definition: value.definition,
          }),
        ),
      );
    },
    async validate(input) {
      const value = validateSequenceInputSchema.parse(input);
      return execute("validation", () =>
        provider().then((client) =>
          client.validateSequence({
            workspace: value.workspace,
            environment: value.environment,
            definition: value.definition,
          }),
        ),
      );
    },
    async diff(input) {
      const value = diffSequenceInputSchema.parse(input);
      return execute("diff", () =>
        provider().then((client) =>
          client.diffSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
            baseRevision: value.base_revision,
            definition: value.definition,
          }),
        ),
      );
    },
    async export(input) {
      const value = exportSequenceInputSchema.parse(input);
      return execute("export", () =>
        provider().then((client) =>
          client.exportSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
          }),
        ),
      );
    },
    async simulate(input) {
      const value = simulateSequenceInputSchema.parse(input);
      return execute("simulation", () =>
        provider().then((client) =>
          client.simulateSequence({
            workspace: value.workspace,
            environment: value.environment,
            sequenceId: value.sequence_id,
            enteredAtMs: value.entered_at_ms,
            assumedAcceptedAtMs: value.assumed_accepted_at_ms,
          }),
        ),
      );
    },
  };
}

async function execute<Key extends string, Value>(
  key: Key,
  operation: () => Promise<Value>,
): Promise<SequenceToolResult<Key, Value>> {
  try {
    return {
      outcome: "completed",
      reason: null,
      status_code: null,
      core_effect: "none",
      [key]: await operation(),
    } as SequenceToolResult<Key, Value>;
  } catch (error) {
    return { ...sequenceMcpFailure(error), [key]: null } as SequenceToolResult<
      Key,
      Value
    >;
  }
}
