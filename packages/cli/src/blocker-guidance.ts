import type { BlockReason } from "./types.js";

const guidance: Record<BlockReason, { summary: string; next: string }> = {
  ambiguous_app_router_root: {
    summary: "Fonte found more than one Next.js App Router root.",
    next: "Keep one app/layout file or one src/app/layout file, then retry.",
  },
  dependency_version_conflict: {
    summary: "The project declares a conflicting Fonte SDK dependency.",
    next: "Resolve the @fonte-is/nextjs dependency conflict, then retry.",
  },
  existing_unmanaged_path: {
    summary: "A project-owned file already occupies a path Fonte needs.",
    next: "Inspect that file and decide whether to move it before retrying.",
  },
  installation_manifest_invalid: {
    summary: "The local Fonte ownership manifest is invalid.",
    next: "Inspect local Fonte changes before retrying; do not delete unknown work.",
  },
  installation_not_found: {
    summary: "This project does not have a verifiable Fonte installation.",
    next: "Run fonte init first.",
  },
  installed_sdk_invalid: {
    summary:
      "The installed Fonte SDK metadata or files do not match the supported release.",
    next: "Reinstall the exact supported SDK version, then retry.",
  },
  local_state_not_ignored: {
    summary: "Fonte local ownership state is not ignored by Git.",
    next: "Restore the Fonte-managed ignore rule, then retry.",
  },
  managed_code_drifted: {
    summary:
      "Fonte detected a local or concurrent change and refused to overwrite it.",
    next: "Inspect and preserve the local change before retrying.",
  },
  managed_path_unsafe: {
    summary: "A managed path is unsafe or escapes the project.",
    next: "Preserve its contents before removing the symlink or unsafe path.",
  },
  project_manifest_invalid: {
    summary: "The project package.json is missing or invalid.",
    next: "Repair package.json, then retry.",
  },
  unsupported_framework: {
    summary: "Fonte did not find one supported Next.js App Router layout.",
    next: "Run the CLI from a supported Next.js App Router project.",
  },
  unsupported_package_manager: {
    summary: "This CLI release supports npm projects only.",
    next: "Use an npm project or wait for support for this package manager.",
  },
};

export function blockerGuidance(reason: string) {
  return (
    guidance[reason as BlockReason] ?? {
      summary: "Fonte could not verify this local operation.",
      next: "Inspect local changes before retrying.",
    }
  );
}
