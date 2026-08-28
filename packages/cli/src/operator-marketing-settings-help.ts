import type { HelpEntry } from "./operator-help.js";

export const workspaceMarketingSettingsHelpEntries: readonly HelpEntry[] = [
  {
    command: ["broadcast", "marketing-settings", "read"],
    usage: [["--workspace <slug> --environment <sandbox|production>"]],
    detail:
      "Reads the authenticated workspace's aggregate marketing postal settings from Core without mutation.",
    json: true,
  },
];
