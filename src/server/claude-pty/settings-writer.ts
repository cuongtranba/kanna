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
  }
  await writeFile(settingsPath, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 })
  return { settingsPath }
}
