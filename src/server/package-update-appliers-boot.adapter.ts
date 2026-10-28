import { skillUpdateApplier } from "./skill-update-applier.adapter"
import { createClaudePluginUpdateApplier } from "./claude-plugin-update-applier.adapter"
import { createCodexPluginUpdateApplier } from "./codex-plugin-update-applier.adapter"
import { resolveCodexBinary } from "./codex-plugin-update-checker.adapter"
import type { PackageUpdateApplier } from "../shared/packages/types"

export function buildPackageUpdateAppliers(claudeBinary: string | null): PackageUpdateApplier[] {
  return [
    skillUpdateApplier,
    createClaudePluginUpdateApplier(claudeBinary),
    createCodexPluginUpdateApplier(resolveCodexBinary()),
  ]
}
