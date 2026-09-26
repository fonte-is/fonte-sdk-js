import type { SegmentMetadataClient } from "./operator-segment-client.js";
import {
  runSegmentOperatorCommand,
  segmentFailureReceipt,
} from "./operator-segment-run.js";
import type {
  SegmentOperatorCommand,
  SegmentOperatorReceipt,
} from "./operator-segment-types.js";
import {
  createSegmentInputSchema,
  listSegmentsInputSchema,
  readSegmentCommandInputSchema,
  readSegmentInputSchema,
  setSegmentArchivedInputSchema,
  updateSegmentInputSchema,
} from "./mcp-segment-types.js";

export const MCP_SEGMENT_TOOLS = [
  "fonte_list_segments",
  "fonte_read_segment",
  "fonte_create_segment",
  "fonte_update_segment",
  "fonte_set_segment_archived",
  "fonte_read_segment_command",
] as const;

export type SegmentMcpClientProvider = () => Promise<SegmentMetadataClient>;

export interface SegmentToolHandlers {
  list(input: unknown): Promise<SegmentOperatorReceipt>;
  read(input: unknown): Promise<SegmentOperatorReceipt>;
  create(input: unknown): Promise<SegmentOperatorReceipt>;
  update(input: unknown): Promise<SegmentOperatorReceipt>;
  setArchived(input: unknown): Promise<SegmentOperatorReceipt>;
  receipt(input: unknown): Promise<SegmentOperatorReceipt>;
}

export function createSegmentToolHandlers(
  provider: SegmentMcpClientProvider,
): SegmentToolHandlers {
  return {
    async list(input) {
      const value = listSegmentsInputSchema.parse(input);
      return run({ kind: "segment_list", ...value }, provider);
    },
    async read(input) {
      const value = readSegmentInputSchema.parse(input);
      return run({ kind: "segment_read", ...value }, provider);
    },
    async create(input) {
      const value = createSegmentInputSchema.parse(input);
      return run({ kind: "segment_create", ...value }, provider);
    },
    async update(input) {
      const value = updateSegmentInputSchema.parse(input);
      return run({ kind: "segment_update", ...value }, provider);
    },
    async setArchived(input) {
      const value = setSegmentArchivedInputSchema.parse(input);
      return run({ kind: "segment_archive", ...value }, provider);
    },
    async receipt(input) {
      const value = readSegmentCommandInputSchema.parse(input);
      return run({ kind: "segment_receipt", ...value }, provider);
    },
  };
}

async function run(
  command: SegmentOperatorCommand,
  provider: SegmentMcpClientProvider,
): Promise<SegmentOperatorReceipt> {
  try {
    return await runSegmentOperatorCommand(command, await provider());
  } catch (error) {
    return segmentFailureReceipt(command, error);
  }
}
