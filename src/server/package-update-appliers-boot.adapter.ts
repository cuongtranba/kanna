import os from "node:os"
import { skillUpdateApplier } from "./skill-update-applier.adapter"
import { createClaudePluginUpdateApplier } from "./claude-plugin-update-applier.adapter"
import { createCodexPluginUpdateApplier } from "./codex-plugin-update-applier.adapter"
import type { PackageUpdateApplier } from "../shared/packages/types"

export function buildPackageUpdateAppliers(claudeBinary: string | null): PackageUpdateApplier[] {
  const home = process.env.HOME ?? os.homedir()
  const codexBinary = process.env.CODEX_BINARY_PATH ?? `${home}/.local/bin/codex`
  return [
    skillUpdateApplier,
    createClaudePluginUpdateApplier(claudeBinary),
    createCodexPluginUpdateApplier(codexBinary),
  ]
}
