import {
  createConnectedAudienceClient,
  type ConnectedAudienceClient,
} from "./connected-audience-client.js";
export * from "./connected-audience-client.js";
import { z } from "zod";
import {
  createContactImportClient,
  type ContactImportClient,
} from "./contact-import-client.js";
export * from "./contact-import-client.js";
export * from "./contact-import-types.js";
import {
  authorizationAttemptRef,
  connection,
  connectionAuthorization,
  connectionChoice,
  connectionChoiceRef,
  connectionRef,
  contactImportOperation,
  contactImportRef,
  contactSourcePreview,
  contactSourceRef,
  contactSources,
  type Connection,
  type ConnectionAuthorization,
  type ConnectionChoice,
  type ContactImportOperation,
  type ContactSourcePreview,
  type ContactSources,
} from "./connection-contracts.js";
import {
  CoreOperatorError,
  type CoreRequester,
} from "./operator-core-request.js";

export const connectionScopeSchema = z.strictObject({
  workspace: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/)
    .refine((value) => !value.includes("--")),
  environment: z.enum(["sandbox", "production"]),
});
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const readConnectionSchema = connectionScopeSchema.extend({
  connectionRef,
});
export const previewContactSourceSchema = connectionScopeSchema.extend({
  sourceRef: contactSourceRef,
});
export const beginConnectionAuthorizationSchema = connectionScopeSchema
  .extend({
    choiceRef: connectionChoiceRef,
    attemptId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      .transform((value) => value.toLowerCase()),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\p{Cc}]+$/u),
    connectionRef: connectionRef.nullable(),
    expectedCredentialVersion: version.nullable(),
  })
  .refine(
    (value) =>
      (value.connectionRef === null) ===
      (value.expectedCredentialVersion === null),
  );
export const importContactsSchema = previewContactSourceSchema.extend({
  idempotencyKey: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[^\p{Cc}]+$/u)
    .refine((value) => value.trim() === value),
});

export type ConnectionScope = z.infer<typeof connectionScopeSchema>;
export type ReadConnectionInput = z.infer<typeof readConnectionSchema>;
export type BeginConnectionAuthorizationInput = z.input<
  typeof beginConnectionAuthorizationSchema
>;
export type ReadConnectionAuthorizationInput = ConnectionScope & {
  readonly attemptRef: string;
};
export type DisconnectConnectionInput = ReadConnectionInput & {
  readonly expectedCredentialVersion: number;
};
export type ListContactSourcesInput = ReadConnectionInput;
export type PreviewContactSourceInput = z.infer<
  typeof previewContactSourceSchema
>;
export type ImportContactsInput = z.infer<typeof importContactsSchema>;
export type ReadContactImportInput = ConnectionScope & {
  readonly operationRef: string;
};
export type {
  Connection,
  ConnectionAuthorization,
  ConnectionChoice,
  ContactImportOperation,
  ContactSourcePreview,
  ContactSources,
} from "./connection-contracts.js";

export interface ConnectionClient
  extends ConnectedAudienceClient, ContactImportClient {
  listConnectionChoices(
    input: ConnectionScope,
  ): Promise<{ choices: ConnectionChoice[] }>;
  listConnections(
    input: ConnectionScope,
  ): Promise<{ connections: Connection[] }>;
  readConnection(input: ReadConnectionInput): Promise<Connection>;
  beginConnectionAuthorization(
    input: BeginConnectionAuthorizationInput,
  ): Promise<ConnectionAuthorization>;
  readConnectionAuthorization(
    input: ReadConnectionAuthorizationInput,
  ): Promise<ConnectionAuthorization>;
  disconnectConnection(input: DisconnectConnectionInput): Promise<Connection>;
  listContactSources(input: ListContactSourcesInput): Promise<ContactSources>;
  previewContactSource(
    input: PreviewContactSourceInput,
  ): Promise<ContactSourcePreview>;
  importContacts(input: ImportContactsInput): Promise<ContactImportOperation>;
  readContactImport(
    input: ReadContactImportInput,
  ): Promise<ContactImportOperation>;
}

/** Uses the same authenticated, bounded Core transport as other Fonte clients. */
export function createConnectionClient(
  request: CoreRequester,
): ConnectionClient {
  return {
    ...createConnectedAudienceClient(request),
    ...createContactImportClient(request),
    async listConnectionChoices(input) {
      const parsed = inputValue(connectionScopeSchema, input);
      return receipt(
        z.strictObject({ choices: z.array(connectionChoice) }),
        await request(path(parsed, "/connections/choices")),
      );
    },
    async listConnections(input) {
      const parsed = inputValue(connectionScopeSchema, input);
      return receipt(
        z.strictObject({ connections: z.array(connection) }),
        await request(path(parsed, "/connections")),
      );
    },
    async readConnection(input) {
      const parsed = inputValue(readConnectionSchema, input);
      const result = receipt(
        connection,
        await request(path(parsed, `/connections/${parsed.connectionRef}`)),
      );
      same(result.connectionRef, parsed.connectionRef, "none");
      return result;
    },
    async beginConnectionAuthorization(input) {
      const parsed = inputValue(beginConnectionAuthorizationSchema, input);
      const {
        workspace: _workspace,
        environment: _environment,
        ...body
      } = parsed;
      const result = receipt(
        connectionAuthorization,
        await request(path(parsed, "/connections/authorizations"), {
          body,
          idempotencyKey: parsed.attemptId,
          lostResponseEffect: "unknown",
        }),
        "unknown",
      );
      same(result.attemptRef, `fca_${parsed.attemptId}`, "unknown");
      if (result.connection && parsed.connectionRef !== null)
        same(result.connection.connectionRef, parsed.connectionRef, "unknown");
      if (result.connection)
        same(result.connection.choiceRef, parsed.choiceRef, "unknown");
      return result;
    },
    async readConnectionAuthorization(input) {
      const parsed = inputValue(
        connectionScopeSchema.extend({ attemptRef: authorizationAttemptRef }),
        input,
      );
      const result = receipt(
        connectionAuthorization,
        await request(
          path(parsed, `/connections/authorizations/${parsed.attemptRef}`),
        ),
      );
      same(result.attemptRef, parsed.attemptRef, "none");
      return result;
    },
    async disconnectConnection(input) {
      const parsed = inputValue(
        readConnectionSchema.extend({ expectedCredentialVersion: version }),
        input,
      );
      const result = receipt(
        connection,
        await request(
          path(parsed, `/connections/${parsed.connectionRef}/disconnect`),
          {
            body: {
              expectedCredentialVersion: parsed.expectedCredentialVersion,
            },
            lostResponseEffect: "unknown",
          },
        ),
        "unknown",
      );
      same(result.connectionRef, parsed.connectionRef, "unknown");
      if (result.status !== "disconnected") invalidReceipt("unknown");
      return result;
    },
    async listContactSources(input) {
      const parsed = inputValue(readConnectionSchema, input);
      const result = receipt(
        contactSources,
        await request(
          path(parsed, `/connections/${parsed.connectionRef}/contact-sources`),
        ),
      );
      if (
        result.sources.some(
          (source) => source.connectionRef !== parsed.connectionRef,
        )
      )
        invalidReceipt("none");
      return result;
    },
    async previewContactSource(input) {
      const parsed = inputValue(previewContactSourceSchema, input);
      const result = receipt(
        contactSourcePreview,
        await request(
          path(parsed, `/contact-sources/${parsed.sourceRef}/preview`),
          {
            body: {},
            lostResponseEffect: "none",
          },
        ),
      );
      same(result.source.sourceRef, parsed.sourceRef, "none");
      return result;
    },
    async importContacts(input) {
      const parsed = inputValue(importContactsSchema, input);
      const result = receipt(
        contactImportOperation,
        await request(path(parsed, "/contact-imports"), {
          body: {
            sourceRef: parsed.sourceRef,
            idempotencyKey: parsed.idempotencyKey,
          },
          idempotencyKey: parsed.idempotencyKey,
          lostResponseEffect: "unknown",
        }),
        "unknown",
      );
      same(result.sourceRef, parsed.sourceRef, "unknown");
      return result;
    },
    async readContactImport(input) {
      const parsed = inputValue(
        connectionScopeSchema.extend({ operationRef: contactImportRef }),
        input,
      );
      const result = receipt(
        contactImportOperation,
        await request(path(parsed, `/contact-imports/${parsed.operationRef}`)),
      );
      same(result.operationRef, parsed.operationRef, "none");
      return result;
    },
  };
}

function path(input: ConnectionScope, suffix: string): string {
  return `/v1/workspaces/${encodeURIComponent(input.workspace)}${suffix}?environment=${input.environment}`;
}
function inputValue<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new CoreOperatorError("connection_request_invalid", null, "none");
  return result.data;
}
function receipt<T extends z.ZodType>(
  schema: T,
  value: unknown,
  effect: "none" | "unknown" = "none",
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) invalidReceipt(effect);
  return result.data;
}
function same(
  actual: unknown,
  expected: string,
  effect: "none" | "unknown",
): void {
  if (actual !== expected) invalidReceipt(effect);
}
function invalidReceipt(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
