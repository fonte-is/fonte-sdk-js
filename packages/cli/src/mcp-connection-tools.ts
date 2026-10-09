import { audienceSourceSchema } from "./connected-audience-client.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  authorizationAttemptRef,
  connectionChoiceRef,
  connectionRef,
  contactImportRef,
  contactSourceRef,
} from "./connection-contracts.js";
import type { ConnectionClient } from "./connection-client.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";

export const MCP_CONNECTION_TOOLS = [
  "fonte_list_connection_choices",
  "fonte_list_connections",
  "fonte_read_connection",
  "fonte_authorize_connection",
  "fonte_read_connection_authorization",
  "fonte_disconnect_connection",
  "fonte_list_contact_sources",
  "fonte_preview_contact_source",
  "fonte_import_contacts",
  "fonte_read_contact_import",
  "fonte_reconcile_audience",
  "fonte_freeze_audience",
  "fonte_read_contact_import_batch",
] as const;

export function registerMcpConnectionTools(
  server: McpServer,
  provider: () => Promise<ConnectionClient>,
): void {
  const scope = {
    workspace: z.string().min(2).max(63),
    environment: z.enum(["sandbox", "production"]),
  };
  const readConnection = z.strictObject({
    ...scope,
    connection_ref: connectionRef,
  });
  const readSource = z.strictObject({ ...scope, source_ref: contactSourceRef });
  const selected = (input: z.infer<typeof readConnection>) => ({
    workspace: input.workspace,
    environment: input.environment,
    connectionRef: input.connection_ref,
  });
  const source = (input: z.infer<typeof readSource>) => ({
    workspace: input.workspace,
    environment: input.environment,
    sourceRef: input.source_ref,
  });
  const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  register(
    MCP_CONNECTION_TOOLS[0],
    z.strictObject(scope),
    "List the connection choices and capabilities Fonte currently offers. Unavailable choices cannot be authorized.",
    false,
    false,
    (client, input) => client.listConnectionChoices(input),
  );
  register(
    MCP_CONNECTION_TOOLS[1],
    z.strictObject(scope),
    "List this workspace's connected accounts and current status. Select an exact returned connection reference.",
    false,
    false,
    (client, input) => client.listConnections(input),
  );
  register(
    MCP_CONNECTION_TOOLS[2],
    readConnection,
    "Read one selected connection's account, capabilities and credential version.",
    false,
    false,
    (client, input) => client.readConnection(selected(input)),
  );
  register(
    MCP_CONNECTION_TOOLS[3],
    z
      .strictObject({
        ...scope,
        choice_ref: connectionChoiceRef,
        attempt_id: z
          .string()
          .regex(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
        display_name: z.string().min(1).max(100),
        connection_ref: connectionRef.nullable().default(null),
        expected_credential_version: version.nullable().default(null),
      })
      .refine(
        (input) =>
          (input.connection_ref === null) ===
          (input.expected_credential_version === null),
      ),
    "Begin authorization using a returned choice reference and a stable attempt UUID. For reconnect, include the existing connection and observed credential version. Follow the returned next action. After response loss, read fca_<the same attempt UUID> or repeat the identical request; never create another attempt as recovery.",
    true,
    false,
    (client, input) =>
      client.beginConnectionAuthorization({
        workspace: input.workspace,
        environment: input.environment,
        choiceRef: input.choice_ref,
        attemptId: input.attempt_id,
        displayName: input.display_name,
        connectionRef: input.connection_ref,
        expectedCredentialVersion: input.expected_credential_version,
      }),
  );
  register(
    MCP_CONNECTION_TOOLS[4],
    z.strictObject({ ...scope, attempt_ref: authorizationAttemptRef }),
    "Read the same authorization attempt after browser closure or an uncertain response. This does not start another authorization.",
    false,
    false,
    (client, input) =>
      client.readConnectionAuthorization({
        workspace: input.workspace,
        environment: input.environment,
        attemptRef: input.attempt_ref,
      }),
  );
  register(
    MCP_CONNECTION_TOOLS[5],
    readConnection.extend({ expected_credential_version: version }),
    "Disconnect the exact selected account using its observed credential version. This stops new connected reads; retained history is preserved under Fonte's privacy rules. After response loss, read the same connection.",
    true,
    true,
    (client, input) =>
      client.disconnectConnection({
        ...selected(input),
        expectedCredentialVersion: input.expected_credential_version,
      }),
  );
  register(
    MCP_CONNECTION_TOOLS[6],
    readConnection,
    "List available contact sources for the exact selected connection. Source references retain their account and workspace scope.",
    false,
    false,
    (client, input) => client.listContactSources(selected(input)),
  );
  register(
    MCP_CONNECTION_TOOLS[7],
    readSource,
    "Preview a contact source's observed counts and coverage. Missing or incomplete evidence is unavailable, never an empty source.",
    false,
    false,
    (client, input) => client.previewContactSource(source(input)),
  );
  register(
    MCP_CONNECTION_TOOLS[8],
    readSource.extend({ idempotency_key: z.string().min(1).max(120) }),
    "Import the selected source into Fonte Contacts using a stable request key. Import preserves permission and suppression evidence; it does not establish marketing consent, freeze an audience or send. After response loss, repeat the identical request and key.",
    true,
    false,
    (client, input) =>
      client.importContacts({
        ...source(input),
        idempotencyKey: input.idempotency_key,
      }),
  );
  register(
    MCP_CONNECTION_TOOLS[9],
    z.strictObject({ ...scope, operation_ref: contactImportRef }),
    "Read the same contact import operation and progress without starting another import.",
    false,
    false,
    (client, input) =>
      client.readContactImport({
        workspace: input.workspace,
        environment: input.environment,
        operationRef: input.operation_ref,
      }),
  );

  const audience = z.strictObject({
    ...scope,
    source: audienceSourceSchema,
    exclusion_source_refs: z.array(contactSourceRef).max(24).default([]),
  });
  register(
    MCP_CONNECTION_TOOLS[10],
    audience,
    "Reconcile a selected Fonte source against explicit exclusion source references. This reads current evidence and counts; it does not import, freeze or send.",
    false,
    false,
    (client, input) =>
      client.reconcileAudience({
        workspace: input.workspace,
        environment: input.environment,
        source: input.source,
        exclusionSourceRefs: input.exclusion_source_refs,
      }),
  );
  register(
    MCP_CONNECTION_TOOLS[11],
    audience.extend({
      expected_observation_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      idempotency_key: z.string().min(1).max(120),
      declared_permission_basis: z
        .enum(["evidence_only", "permission_basis_marketing_claimed"])
        .optional(),
    }),
    "Freeze the exact observed audience with its fingerprint and a stable request key. This retains an immutable audience reference; it does not send or establish verified marketing consent. Changed evidence requires another reconciliation, never a guessed fingerprint.",
    true,
    false,
    (client, input) =>
      client.freezeAudience({
        workspace: input.workspace,
        environment: input.environment,
        source: input.source,
        exclusionSourceRefs: input.exclusion_source_refs,
        expectedObservationFingerprint: input.expected_observation_fingerprint,
        idempotencyKey: input.idempotency_key,
        ...(input.declared_permission_basis === undefined
          ? {}
          : { declaredPermissionBasis: input.declared_permission_basis }),
      }),
  );

  register(
    MCP_CONNECTION_TOOLS[12],
    z.strictObject({ ...scope, contact_import_batch_id: z.string().uuid() }),
    "Read an existing completed Contact import batch and its exact identity-set hash. Use that returned batch and hash together when selecting a Fonte audience; this does not import, freeze or send.",
    false,
    false,
    (client, input) =>
      client.readContactImportStatus({
        workspace: input.workspace,
        environment: input.environment,
        contactImportBatchId: input.contact_import_batch_id,
      }),
  );

  function register<T extends z.ZodType>(
    name: string,
    schema: T,
    description: string,
    mutation: boolean,
    destructive: boolean,
    execute: (client: ConnectionClient, input: z.output<T>) => Promise<unknown>,
  ): void {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema as z.ZodType,
        annotations: {
          readOnlyHint: !mutation,
          destructiveHint: destructive,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (input) => {
        try {
          const value = {
            outcome: "completed",
            receipt: await execute(await provider(), schema.parse(input)),
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent: value,
          };
        } catch (error) {
          const value = { ...sequenceMcpFailure(error) };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent: value,
            isError: true,
          };
        }
      },
    );
  }
}
