import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface WriteSpawnSettingsResult {
  settingsPath: string
}

export async function writeSpawnSettings(args: {
  runtimeDir: string
}): Promise<WriteSpawnSettingsResult> {
  await mkdir(args.runtimeDir, { recursive: true, mode: 0o700 })
  const settingsPath = path.join(args.runtimeDir, "settings.local.json")
  const body = {
    spinnerTipsEnabled: false,
    showTurnDuration: false,
    syntaxHighlightingDisabled: true,
    // Auto-allow every mcp__kanna__* tool at the claude CLI permission gate.
    // Approval still flows through kanna's toolCallback (durable + auditable)
    // when KANNA_MCP_TOOL_CALLBACKS=1; this just stops the CLI from blocking
    // tool_call before our MCP server sees the request.
    permissions: {
      allow: ["mcp__kanna__*"],
    },
  }
  await writeFile(settingsPath, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 })
  return { settingsPath }
}
