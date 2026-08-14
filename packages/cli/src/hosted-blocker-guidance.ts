interface HostedBlockerGuidance {
  readonly summary: string;
  readonly next: string;
}

const guidance: Record<string, HostedBlockerGuidance> = {
  hosted_configuration_unavailable: {
    summary: "Fonte could not load the hosted CLI configuration.",
    next: "Check your connection and retry.",
  },
  hosted_configuration_invalid: {
    summary: "Fonte returned an unsupported CLI configuration.",
    next: "Update the CLI before retrying.",
  },
  browser_open_failed: {
    summary: "Fonte could not open the authorization page.",
    next: "Allow the terminal to open your browser, then retry.",
  },
  authorization_failed: {
    summary: "Browser authorization did not complete.",
    next: "Return to the terminal and start the test again.",
  },
  authorization_denied: {
    summary: "Browser authorization was denied.",
    next: "Retry only if you want to allow this sandbox proof.",
  },
  core_api_unavailable: {
    summary: "Fonte could not reach its hosted email service.",
    next: "Check your connection and retry.",
  },
  provider_readback_timeout: {
    summary: "The provider result did not become terminal in time.",
    next: "Wait before retrying so a second proof is not created unnecessarily.",
  },
  verified_account_email_required: {
    summary: "The signed-in account has no stable verified email recipient.",
    next: "Verify the account email, then retry.",
  },
  sandbox_email_rate_limited: {
    summary: "The sandbox proof was requested too recently.",
    next: "Wait for the displayed retry interval before trying again.",
  },
  sandbox_email_lifetime_limit_reached: {
    summary: "This account has used its sandbox proof allowance.",
    next: "Verify a sending domain to continue with production capability.",
  },
};

export function hostedBlockerGuidance(reason: string): HostedBlockerGuidance {
  return (
    guidance[reason] ?? {
      summary: "Fonte could not complete the sandbox provider proof.",
      next: "Read the exact reason below, then retry only after it is resolved.",
    }
  );
}
