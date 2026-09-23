export type SegmentEnvironment = "sandbox" | "production";

export type SegmentJsonValue =
  | null
  | boolean
  | number
  | string
  | SegmentJsonObject
  | readonly SegmentJsonValue[];

export interface SegmentJsonObject {
  readonly [key: string]: SegmentJsonValue;
}

export interface SegmentScopeInput {
  readonly workspace: string;
  readonly environment: SegmentEnvironment;
}

export interface SegmentListInput extends SegmentScopeInput {
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeArchived?: boolean;
}

export interface SegmentReadInput extends SegmentScopeInput {
  readonly segmentId: string;
  readonly revision?: number;
}

export interface SegmentCreateInput extends SegmentScopeInput {
  readonly segmentId: string;
  readonly operationId: string;
  readonly title: string;
  readonly rule: SegmentJsonObject;
}

export interface SegmentUpdateInput extends SegmentScopeInput {
  readonly segmentId: string;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly title: string;
  readonly rule: SegmentJsonObject;
}

export interface SegmentArchiveInput extends SegmentScopeInput {
  readonly segmentId: string;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly archived: boolean;
}

export interface SegmentCommandReceiptInput extends SegmentScopeInput {
  readonly operationId: string;
}

export interface SegmentListItemWire {
  readonly segmentId: string;
  readonly revision: number;
  readonly title: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SegmentRevisionWire {
  readonly segmentId: string;
  readonly revision: number;
  readonly title: string;
  readonly rule: SegmentJsonObject;
  readonly ruleDigest: string;
  readonly semanticsVersion: "native_rule.v1";
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SegmentWireReceipt {
  readonly operationId: string;
  readonly commandKind: "create" | "update" | "setArchived";
  readonly segmentId: string;
  readonly resultingRevision: number;
  readonly committedAt: string;
}

export interface SegmentListEnvelope {
  readonly schemaVersion: "native_segment.v1";
  readonly tenantId: string;
  readonly environment: SegmentEnvironment;
  readonly segments: readonly SegmentListItemWire[];
  readonly nextCursor: string | null;
}

export interface SegmentReadEnvelope {
  readonly schemaVersion: "native_segment.v1";
  readonly tenantId: string;
  readonly environment: SegmentEnvironment;
  readonly segment: SegmentRevisionWire;
}

export interface SegmentCommandEnvelope {
  readonly schemaVersion: "native_segment.v1";
  readonly tenantId: string;
  readonly environment: SegmentEnvironment;
  readonly segment: SegmentRevisionWire;
  readonly receipt: SegmentWireReceipt;
  readonly replayed: boolean;
}

export type SegmentMetadataEnvelope =
  SegmentListEnvelope | SegmentReadEnvelope | SegmentCommandEnvelope;

export type SegmentOperatorCommand =
  | ({ readonly kind: "segment_list" } & SegmentListInput)
  | ({ readonly kind: "segment_read" } & SegmentReadInput)
  | ({ readonly kind: "segment_create" } & SegmentCreateInput)
  | ({ readonly kind: "segment_update" } & SegmentUpdateInput)
  | ({ readonly kind: "segment_archive" } & SegmentArchiveInput)
  | ({ readonly kind: "segment_receipt" } & SegmentCommandReceiptInput);

export interface SegmentOperatorReceipt {
  readonly schema_version: "fonte.cli.operator_receipt.v1";
  readonly command: SegmentOperatorCommand["kind"];
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly workspace: string;
  readonly authority: {
    readonly status: "current";
    readonly contract_id: "fonte.core.native_segment.v1";
  };
  readonly core_effect: "none" | "created" | "replaced" | "unknown";
  readonly next_action?: {
    readonly kind: "read_segment_command";
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
    readonly operation_id: string;
    readonly resource_id: string;
  };
  readonly result: SegmentMetadataEnvelope | null;
}
