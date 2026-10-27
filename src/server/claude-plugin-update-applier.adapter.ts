import type { PackageUpdateApplier } from "../shared/packages/types"
import { createCliPluginUpdateApplier } from "./package-apply-command.adapter"

function splitQualifiedName(name: string): { plugin: string; marketplace: string | null } {
  const atIdx = name.indexOf("@")
  return atIdx >= 0 ? { plugin: name.slice(0, atIdx), marketplace: name.slice(atIdx + 1) } : { plugin: name, marketplace: null }
}

export function createClaudePluginUpdateApplier(claudeBinary: string | null): PackageUpdateApplier {
  return createCliPluginUpdateApplier(claudeBinary, {
    kind: "claude-plugin",
    cli: "claude",
    refreshCommand: (binary, pkg) => {
      const { marketplace } = splitQualifiedName(pkg.name)
      return marketplace ? [binary, "plugin", "marketplace", "update", marketplace] : null
    },
    installCommand: (binary, pkg) => {
      const { plugin, marketplace } = splitQualifiedName(pkg.name)
      const qualifiedName = marketplace ? `${plugin}@${marketplace}` : plugin
      return [binary, "plugin", "update", qualifiedName, "-s", "user", "-y"]
    },
    installLabel: "claude plugin update",
  })
}
