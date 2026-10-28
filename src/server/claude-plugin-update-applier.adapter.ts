import { parseClaudePluginName } from "../shared/packages/parse-claude-plugin-marketplace"
import type { PackageUpdateApplier } from "../shared/packages/types"
import { createCliPluginUpdateApplier } from "./package-apply-command.adapter"

export function createClaudePluginUpdateApplier(claudeBinary: string | null): PackageUpdateApplier {
  return createCliPluginUpdateApplier(claudeBinary, {
    kind: "claude-plugin",
    cli: "claude",
    refreshCommand: (binary, pkg) => {
      const { marketplace } = parseClaudePluginName(pkg.name)
      return marketplace ? [binary, "plugin", "marketplace", "update", marketplace] : null
    },
    installCommand: (binary, pkg) => {
      const { plugin, marketplace } = parseClaudePluginName(pkg.name)
      const qualifiedName = marketplace ? `${plugin}@${marketplace}` : plugin
      return [binary, "plugin", "update", qualifiedName, "-s", "user", "-y"]
    },
    installLabel: "claude plugin update",
  })
}
