import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  createSandboxDraft,
  pollSandboxCanary,
  queueSandboxCanary,
} from "./hosted-test-api.js";
import type { HostedTestDependencies } from "./runtime-types.js";
import type { HostedTestReceipt } from "./types.js";

export async function runHostedTest(
  workspace: string,
  idempotencyKey: string,
  dependencies: HostedTestDependencies,
): Promise<HostedTestReceipt> {
  let providerSubmission: HostedTestReceipt["provider_submission"] =
    "not_requested";
  let sandboxDraftId: string | null = null;
  let sandboxDraftRetained: boolean | null = false;
  try {
    const config = await loadHostedConfig(dependencies.fetch as typeof fetch);
    const token = await dependencies.authorize(config);
    sandboxDraftRetained = null;
    const draft = await createSandboxDraft(
      config,
      workspace,
      token,
      dependencies.fetch,
    );
    sandboxDraftId = draft.draftId;
    sandboxDraftRetained = true;
    providerSubmission = "processing";
    const canaryId = await queueSandboxCanary(
      config,
      workspace,
      token,
      draft,
      idempotencyKey,
      dependencies.fetch,
    );
    const result = await pollSandboxCanary(
      config,
      workspace,
      token,
      canaryId,
      dependencies,
    );
    return {
      schema_version: "fonte.cli.test_receipt.v1",
      command: "test",
      outcome: "terminal",
      reason: "provider_submission_terminal",
      workspace,
      sandbox_draft_id: sandboxDraftId,
      sandbox_draft_retained: true,
      local_verification: "passed",
      account_created: false,
      production_email: "locked_pending_verified_domain",
      provider_submission: result.providerSubmission,
      provider_message_id: result.providerMessageId,
      provider_error_code: result.providerErrorCode,
      accepted_email_usage_quantity: result.acceptedEmailUsageQuantity,
      inbox_delivery_confirmed: false,
      token_persisted: false,
    };
  } catch (error) {
    const reason =
      error instanceof HostedTestBlockedError
        ? error.reason
        : "hosted_test_failed";
    return testBlockedReceipt(
      workspace,
      reason,
      "passed",
      providerSubmission,
      sandboxDraftId,
      sandboxDraftRetained,
    );
  }
}

export function testBlockedReceipt(
  workspace: string,
  reason: string,
  localVerification: "passed" | "failed" = "passed",
  providerSubmission: HostedTestReceipt["provider_submission"] = "not_requested",
  sandboxDraftId: string | null = null,
  sandboxDraftRetained: boolean | null = sandboxDraftId !== null,
): HostedTestReceipt {
  return {
    schema_version: "fonte.cli.test_receipt.v1",
    command: "test",
    outcome: "blocked",
    reason,
    workspace,
    sandbox_draft_id: sandboxDraftId,
    sandbox_draft_retained: sandboxDraftRetained,
    local_verification: localVerification,
    account_created: false,
    production_email: "locked_pending_verified_domain",
    provider_submission: providerSubmission,
    provider_message_id: null,
    provider_error_code: null,
    accepted_email_usage_quantity: null,
    inbox_delivery_confirmed: false,
    token_persisted: false,
  };
}
