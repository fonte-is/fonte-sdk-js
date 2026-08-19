export const CLI_VERSION = "0.1.0";
export const SDK_PACKAGE = "@fonte-is/nextjs";
export const SDK_VERSION = "0.1.0";
export const ADAPTER_ID = "next_app_router";
export const ADAPTER_VERSION = "v1";

export const PLAN_SCHEMA_VERSION = "fonte.cli.plan.v1";
export const MANIFEST_SCHEMA_VERSION = "fonte.local_installation.v1";
export const RECEIPT_SCHEMA_VERSION = "fonte.cli.receipt.v1";

export const MANAGED_SOURCE_PATH = "fonte/installation.ts";
export const LOCAL_MANIFEST_PATH = ".fonte/installation.json";
export const IGNORE_PATH = ".gitignore";

export const IGNORE_BLOCK_TEXT = [
  "# >>> Fonte managed local state",
  "/.fonte/",
  "# <<< Fonte managed local state",
  "",
].join("\n");

export const MANAGED_SOURCE_TEXT = [
  "export {",
  "  INSTALLATION_VERIFICATION_ADAPTER_ID,",
  "  INSTALLATION_VERIFICATION_ADAPTER_VERSION,",
  "  normalizeInstallationVerificationConfig,",
  '} from "@fonte-is/nextjs/installation-verification";',
  "",
].join("\n");

export const INSTALL_COMMAND = [
  "install",
  "--save-exact",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  `${SDK_PACKAGE}@${SDK_VERSION}`,
] as const;

export const UNINSTALL_COMMAND = [
  "uninstall",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  SDK_PACKAGE,
] as const;

export const RECONCILE_COMMAND = [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
] as const;

export const USAGE_TEXT = [
  "Usage:",
  "  fonte init [--yes] [--json]",
  "  fonte doctor [--json]",
  "  fonte test --workspace <slug> [--json]",
  "  fonte auth exec -- <command> [args...]",
  "  fonte remove [--yes] [--json]",
  "  fonte --help",
  "  fonte --version",
  "",
].join("\n");

export const HELP_TEXT = [
  "Fonte local installation CLI.",
  "",
  USAGE_TEXT.trimEnd(),
  "",
  "init and remove print a plan unless --yes is supplied.",
  "test opens Fonte in your browser and requests one sandbox provider proof.",
  "auth exec opens Fonte in your browser and runs one bearer-bound child.",
  "Production and transactional application email remain locked.",
  "",
].join("\n");

export const VERSION_TEXT = `@fonte-is/cli ${CLI_VERSION}\n`;
export const EXECUTION_ERROR_TEXT = "Fonte failed: execution_failed.\n";
export const ROLLBACK_ERROR_TEXT = "Fonte failed: rollback_failed.\n";
export const AUTHORIZATION_ERROR_TEXT = "Fonte authorization failed.\n";
