import path from "node:path"
import { openClaudeCliCommands } from "./claude-cli-commands"
import { createClaudeCliCommandFile } from "./claude-cli-commands-file.adapter"
import { LocalCatalogService } from "./local-catalog"
import { defaultHomeDir, scanLocalCatalog, statMtimes } from "./local-catalog-io.adapter"

export async function createSlashCommandSources(dataDir: string, onCliCommandsChange: () => void, homeDir: string = defaultHomeDir()) {
  const localCatalog = new LocalCatalogService({
    scan: scanLocalCatalog,
    statMtimes,
    homeDir,
  })
  const cliCommands = await openClaudeCliCommands(
    createClaudeCliCommandFile(path.join(dataDir, "claude-cli-commands.json")),
    onCliCommandsChange,
  )
  return { localCatalog, cliCommands }
}
