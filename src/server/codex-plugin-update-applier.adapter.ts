import type { PackageUpdateApplier } from "../shared/packages/types"
import { createCliPluginUpdateApplier } from "./package-apply-command.adapter"

export function createCodexPluginUpdateApplier(codexBinary: string | null): PackageUpdateApplier {
  return createCliPluginUpdateApplier(codexBinary, {
    kind: "codex-plugin",
    cli: "codex",
    refreshCommand: (binary) => [binary, "plugin", "marketplace", "upgrade"],
    installCommand: (binary, pkg) => [binary, "plugin", "add", pkg.name],
    installLabel: "codex plugin add",
  })
}
