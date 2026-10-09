import {
  reconcileAudienceSchema,
  freezeAudienceSchema,
} from "./connected-audience-client.js";
import { z } from "zod";
import {
  beginConnectionAuthorizationSchema,
  connectionScopeSchema,
  createConnectionClient,
  importContactsSchema,
  previewContactSourceSchema,
  readConnectionSchema,
} from "./connection-client.js";
import {
  authorizationAttemptRef,
  contactImportRef,
} from "./connection-contracts.js";
import { createCoreRequester } from "./operator-core-request.js";
import { loadHostedConfig } from "./hosted-config.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import type { CommandResult, ProgramDependencies } from "./runtime-types.js";

export const CONNECTION_HELP = [
  "Fonte connections and contact imports:",
  "  fonte connections choices|list --workspace <slug> --environment <sandbox|production>",
  "  fonte connections read --workspace <slug> --environment <sandbox|production> --connection-ref <ref>",
  "  fonte connections authorize --workspace <slug> --environment <sandbox|production> --choice-ref <ref> --attempt-id <uuid> --display-name <label>",
  "    Reconnect: add --connection-ref <ref> --expected-credential-version <n>",
  "  fonte connections authorization --workspace <slug> --environment <sandbox|production> --attempt-ref <ref>",
  "  fonte connections disconnect --workspace <slug> --environment <sandbox|production> --connection-ref <ref> --expected-credential-version <n>",
  "  fonte contacts sources --workspace <slug> --environment <sandbox|production> --connection-ref <ref>",
  "  fonte contacts preview --workspace <slug> --environment <sandbox|production> --source-ref <ref>",
  "  fonte contacts import --workspace <slug> --environment <sandbox|production> --source-ref <ref> --idempotency-key <key>",
  "  fonte contacts import-status --workspace <slug> --environment <sandbox|production> --operation-ref <ref>",
  "",
  "Advanced audience operations:",
  "  fonte audience reconcile --workspace <slug> --environment <sandbox|production> --source-ref <ref> [--exclude-source-ref <ref>]",
  "  fonte audience freeze --workspace <slug> --environment <sandbox|production> --source-ref <ref> --fingerprint <sha256> --idempotency-key <key> [--exclude-source-ref <ref>]",
  "  For an existing Fonte audience, replace --source-ref with --contact-import-batch-id <uuid> --identity-set-sha256 <sha256>.",
  "",
  "Add --json for a machine-readable receipt. Use references returned by Fonte.",
  "After an uncertain authorization or import, reuse its original attempt or request key.",
  "Importing contacts does not establish permission to email them or send a Broadcast.",
  "",
].join("\n");

const command = z.discriminatedUnion("kind", [
  reconcileAudienceSchema.extend({ kind: z.literal("reconcile") }),
  freezeAudienceSchema.extend({ kind: z.literal("freeze") }),
  connectionScopeSchema.extend({ kind: z.literal("choices") }),
  connectionScopeSchema.extend({ kind: z.literal("list") }),
  readConnectionSchema.extend({ kind: z.literal("read") }),
  beginConnectionAuthorizationSchema.safeExtend({
    kind: z.literal("authorize"),
  }),
  connectionScopeSchema.extend({
    kind: z.literal("authorization"),
    attemptRef: authorizationAttemptRef,
  }),
  readConnectionSchema.extend({
    kind: z.literal("disconnect"),
    expectedCredentialVersion: z.number().int().positive(),
  }),
  readConnectionSchema.extend({ kind: z.literal("sources") }),
  previewContactSourceSchema.extend({ kind: z.literal("preview") }),
  importContactsSchema.extend({ kind: z.literal("import") }),
  connectionScopeSchema.extend({
    kind: z.literal("import-status"),
    operationRef: contactImportRef,
  }),
]);
const flags: Record<string, string> = {
  "--fingerprint": "expectedObservationFingerprint",
  "--contact-import-batch-id": "contactImportBatchId",
  "--identity-set-sha256": "identitySetSha256",
  "--declared-permission-basis": "declaredPermissionBasis",
  "--workspace": "workspace",
  "--environment": "environment",
  "--connection-ref": "connectionRef",
  "--source-ref": "sourceRef",
  "--choice-ref": "choiceRef",
  "--attempt-id": "attemptId",
  "--display-name": "displayName",
  "--expected-credential-version": "expectedCredentialVersion",
  "--attempt-ref": "attemptRef",
  "--idempotency-key": "idempotencyKey",
  "--operation-ref": "operationRef",
};

/** Handles only the connection/import grammar; other CLI domains retain their owners. */
export async function runConnectionProgram(
  argv: readonly string[],
  dependencies: ProgramDependencies,
): Promise<CommandResult | null> {
  if (
    argv[0] !== "connections" &&
    argv[0] !== "contacts" &&
    argv[0] !== "audience"
  )
    return null;
  if (argv.length <= 3 && argv.at(-1) === "--help")
    return { exitCode: 0, stdout: CONNECTION_HELP, stderr: "" };
  const json = argv.includes("--json");
  let parsed: z.infer<typeof command>;
  try {
    const kind = argv[1];
    if (
      argv[0] === "connections" &&
      ![
        "choices",
        "list",
        "read",
        "authorize",
        "authorization",
        "disconnect",
      ].includes(kind ?? "")
    )
      throw new Error();
    if (
      argv[0] === "contacts" &&
      !["sources", "preview", "import", "import-status"].includes(kind ?? "")
    )
      throw new Error();
    if (argv[0] === "audience" && !["reconcile", "freeze"].includes(kind ?? ""))
      throw new Error();
    const raw: Record<string, unknown> = { kind };
    const exclusionSourceRefs: string[] = [];
    for (let index = 2; index < argv.length; index++) {
      const flag = argv[index]!;
      if (flag === "--json" && raw.json === undefined) {
        raw.json = true;
        continue;
      }
      const key = flags[flag];
      const value = argv[++index];
      if (
        flag === "--exclude-source-ref" &&
        argv[0] === "audience" &&
        value &&
        !value.startsWith("--")
      ) {
        exclusionSourceRefs.push(value);
        continue;
      }
      if (!key || Object.hasOwn(raw, key) || !value || value.startsWith("--"))
        throw new Error();
      if (key === "expectedCredentialVersion" && !/^[1-9][0-9]*$/.test(value))
        throw new Error();
      raw[key] = key === "expectedCredentialVersion" ? Number(value) : value;
    }
    delete raw.json;
    if (kind === "authorize") {
      raw.connectionRef ??= null;
      raw.expectedCredentialVersion ??= null;
    }
    if (argv[0] === "audience") {
      if (
        raw.sourceRef !== undefined &&
        (raw.contactImportBatchId !== undefined ||
          raw.identitySetSha256 !== undefined)
      )
        throw new Error();
      raw.source =
        raw.sourceRef === undefined
          ? {
              kind: "fonte_audience",
              contactImportBatchId: raw.contactImportBatchId,
              identitySetSha256: raw.identitySetSha256,
            }
          : { kind: "connected_source", sourceRef: raw.sourceRef };
      delete raw.sourceRef;
      delete raw.contactImportBatchId;
      delete raw.identitySetSha256;
      raw.exclusionSourceRefs = exclusionSourceRefs;
    }
    parsed = command.parse(raw);
  } catch {
    return {
      exitCode: 2,
      stdout: json
        ? `${JSON.stringify({ outcome: "invalid_invocation", reason: "connection_request_invalid", core_effect: "none" })}\n`
        : "",
      stderr: json ? "" : CONNECTION_HELP,
    };
  }
  try {
    const auth = dependencies.operator;
    if (!auth)
      return {
        exitCode: 3,
        stdout: "",
        stderr: "Sign in with fonte auth login.\n",
      };
    const config = await loadHostedConfig(
      auth.fetch as typeof fetch,
      auth.configUrl,
    );
    const bearer = await auth.authorize(config, auth.signal);
    const client = createConnectionClient(
      createCoreRequester({
        coreApiBaseUrl: config.coreApiBaseUrl,
        bearer,
        fetch: auth.fetch as typeof fetch,
        signal: auth.signal,
        maxResponseBytes: 1_048_576,
      }),
    );
    const { kind, ...input } = parsed;
    // Narrow each input at the same schema used by the client before authentication.
    const receipt = await execute();
    const value = { outcome: "completed", receipt };
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(value, null, json ? undefined : 2)}\n`,
      stderr: "",
    };

    function execute(): Promise<unknown> {
      switch (parsed.kind) {
        case "reconcile":
          return client.reconcileAudience(reconcileAudienceSchema.parse(input));
        case "freeze":
          return client.freezeAudience(freezeAudienceSchema.parse(input));
        case "choices":
          return client.listConnectionChoices(input);
        case "list":
          return client.listConnections(input);
        case "read":
          return client.readConnection(readConnectionSchema.parse(input));
        case "authorize":
          return client.beginConnectionAuthorization(
            beginConnectionAuthorizationSchema.parse(input),
          );
        case "authorization":
          return client.readConnectionAuthorization(
            connectionScopeSchema
              .extend({ attemptRef: authorizationAttemptRef })
              .parse(input),
          );
        case "disconnect":
          return client.disconnectConnection(
            readConnectionSchema
              .extend({
                expectedCredentialVersion: z.number().int().positive(),
              })
              .parse(input),
          );
        case "sources":
          return client.listContactSources(readConnectionSchema.parse(input));
        case "preview":
          return client.previewContactSource(
            previewContactSourceSchema.parse(input),
          );
        case "import":
          return client.importContacts(importContactsSchema.parse(input));
        case "import-status":
          return client.readContactImport(
            connectionScopeSchema
              .extend({ operationRef: contactImportRef })
              .parse(input),
          );
      }
    }
  } catch (error) {
    const value = sequenceMcpFailure(error);
    return { exitCode: 3, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
  }
}
