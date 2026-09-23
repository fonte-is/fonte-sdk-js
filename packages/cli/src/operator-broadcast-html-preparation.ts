import type {
  BroadcastDraftLifecycleClient,
  BroadcastDraftLifecycleResult,
} from "./operator-broadcast-draft-lifecycle-client.js";
import type {
  BroadcastDraftRevisionClient,
  BroadcastDraftRevisionResult,
} from "./operator-broadcast-draft-revision-client.js";
import type { BroadcastRenderTestClient } from "./operator-broadcast-render-test-client.js";
import type { BroadcastDraftRenderResult } from "./operator-broadcast-render-test-types.js";
import type { BroadcastLocalFileReader } from "./operator-broadcast-html-file.js";
import {
  prepareBroadcastHtmlSource,
  type BroadcastHtmlSource,
  type BroadcastHtmlSourceReport,
} from "./operator-broadcast-html-source.js";

interface SourceOptions {
  readonly sourceFile: string;
  readonly referenceFile: string | null;
  readonly postalAddressLiteral: string | null;
  readonly literalFallbacks: Readonly<Record<string, string>>;
}

export interface PrepareBroadcastHtmlInput extends SourceOptions {
  readonly workspace: string;
  readonly draftId: string;
  readonly title: string;
  readonly subject: string | null;
  readonly preheader: string | null;
}

export interface ReviseBroadcastHtmlInput extends SourceOptions {
  readonly workspace: string;
  readonly draftId: string;
  readonly baseRevision: number;
  readonly operationId: string;
}

export interface BroadcastHtmlPreparationBlocked {
  readonly kind: "broadcast_html_preparation_blocked";
  readonly action: "create" | "revise";
  readonly source: BroadcastHtmlSourceReport;
}

export interface BroadcastHtmlPreparationSuccess {
  readonly kind: "broadcast_html_preparation";
  readonly action: "create" | "revise";
  readonly source: BroadcastHtmlSourceReport;
  readonly save: BroadcastDraftLifecycleResult | BroadcastDraftRevisionResult;
  readonly readback: BroadcastDraftLifecycleResult;
  readonly render: BroadcastDraftRenderResult;
}

export type BroadcastHtmlPreparationResult =
  BroadcastHtmlPreparationBlocked | BroadcastHtmlPreparationSuccess;

export interface BroadcastHtmlPreparationClient {
  prepareBroadcastHtml(
    input: PrepareBroadcastHtmlInput,
  ): Promise<BroadcastHtmlPreparationResult>;
  reviseBroadcastHtml(
    input: ReviseBroadcastHtmlInput,
  ): Promise<BroadcastHtmlPreparationResult>;
}

export interface BroadcastHtmlPreparationDependencies {
  readonly readFile: BroadcastLocalFileReader;
  readonly lifecycle: () => Promise<BroadcastDraftLifecycleClient>;
  readonly revision: () => Promise<BroadcastDraftRevisionClient>;
  readonly render: () => Promise<BroadcastRenderTestClient>;
}

export class BroadcastHtmlPreparationStageError extends Error {
  public constructor(
    readonly stage: "save" | "readback" | "render",
    readonly source: BroadcastHtmlSourceReport,
    readonly save: BroadcastHtmlPreparationSuccess["save"] | null,
    readonly readback: BroadcastDraftLifecycleResult | null,
    readonly cause: unknown,
  ) {
    super("broadcast_html_preparation_stage_failed");
    this.name = "BroadcastHtmlPreparationStageError";
  }
}

export class BroadcastHtmlPreparationContractError extends Error {
  public constructor(readonly reason: string) {
    super(reason);
    this.name = "BroadcastHtmlPreparationContractError";
  }
}

export function createBroadcastHtmlPreparationClient(
  dependencies: BroadcastHtmlPreparationDependencies,
): BroadcastHtmlPreparationClient {
  return {
    async prepareBroadcastHtml(input) {
      const source = await prepareBroadcastHtmlSource(
        {
          ...input,
          requireSubject: true,
          subject: input.subject,
          preheader: input.preheader,
        },
        dependencies.readFile,
      );
      if (source.report.blockers.length > 0) return blocked("create", source);
      let save: BroadcastDraftLifecycleResult;
      try {
        const client = await dependencies.lifecycle();
        save = await client.createBroadcastDraft({
          workspace: input.workspace,
          draftId: input.draftId,
          title: input.title,
          subject: input.subject,
          preheader: input.preheader,
          activeSource: "html",
          composerBody: null,
          htmlBody: source.html,
        });
      } catch (error) {
        throw stageError("save", source, null, null, error);
      }
      return finish(
        "create",
        input.workspace,
        input.draftId,
        source,
        save,
        dependencies,
      );
    },

    async reviseBroadcastHtml(input) {
      const source = await prepareBroadcastHtmlSource(
        {
          ...input,
          requireSubject: false,
          subject: null,
          preheader: null,
        },
        dependencies.readFile,
      );
      if (source.report.blockers.length > 0) return blocked("revise", source);
      let save: BroadcastDraftRevisionResult;
      try {
        save = await (
          await dependencies.revision()
        ).reviseBroadcastDraft({
          workspace: input.workspace,
          draftId: input.draftId,
          baseRevision: input.baseRevision,
          operationId: input.operationId,
          changes: { activeSource: "html", htmlBody: source.html },
        });
      } catch (error) {
        throw stageError("save", source, null, null, error);
      }
      return finish(
        "revise",
        input.workspace,
        input.draftId,
        source,
        save,
        dependencies,
      );
    },
  };
}

async function finish(
  action: "create" | "revise",
  workspace: string,
  draftId: string,
  source: BroadcastHtmlSource,
  save: BroadcastHtmlPreparationSuccess["save"],
  dependencies: BroadcastHtmlPreparationDependencies,
): Promise<BroadcastHtmlPreparationSuccess> {
  let readback: BroadcastDraftLifecycleResult;
  try {
    readback = await (
      await dependencies.lifecycle()
    ).readBroadcastDraft({
      workspace,
      draftId,
    });
    if (
      readback.revision !== save.revision ||
      readback.draft.active_source !== "html" ||
      readback.draft.html_body !== source.html
    ) {
      throw new BroadcastHtmlPreparationContractError(
        "broadcast_source_readback_mismatch",
      );
    }
  } catch (error) {
    throw stageError("readback", source, save, null, error);
  }
  try {
    const render = await (
      await dependencies.render()
    ).renderBroadcastDraft({
      workspace,
      draftId,
      revision: readback.revision,
    });
    return {
      kind: "broadcast_html_preparation",
      action,
      source: source.report,
      save,
      readback,
      render,
    };
  } catch (error) {
    throw stageError("render", source, save, readback, error);
  }
}

function blocked(
  action: "create" | "revise",
  source: BroadcastHtmlSource,
): BroadcastHtmlPreparationBlocked {
  return {
    kind: "broadcast_html_preparation_blocked",
    action,
    source: source.report,
  };
}

function stageError(
  stage: BroadcastHtmlPreparationStageError["stage"],
  source: BroadcastHtmlSource,
  save: BroadcastHtmlPreparationSuccess["save"] | null,
  readback: BroadcastDraftLifecycleResult | null,
  cause: unknown,
): BroadcastHtmlPreparationStageError {
  return new BroadcastHtmlPreparationStageError(
    stage,
    source.report,
    save,
    readback,
    cause,
  );
}
