
import type { SlashCommand } from "../shared/types"
import { BUILTIN_SLASH_COMMANDS } from "../shared/builtin-commands"
import { log } from "../shared/log"

interface SlashCommandsLocalCatalog {
  list(cwd: string): SlashCommand[]
}

export interface SlashCommandsDeps {
  localCatalog: SlashCommandsLocalCatalog | null
}

export function localCommandsForCwd(
  deps: Pick<SlashCommandsDeps, "localCatalog">,
  cwd: string,
): SlashCommand[] {
  const builtins = [...BUILTIN_SLASH_COMMANDS]
  if (!deps.localCatalog) return builtins
  try {
    const builtinNames = new Set(builtins.map((command) => command.name.toLowerCase()))
    const disk = deps.localCatalog
      .list(cwd)
      .filter((command) => !builtinNames.has(command.name.toLowerCase()))
    return [...builtins, ...disk]
  } catch (error) {
    log.warn("[kanna/agent] localCatalog.list failed", String(error))
    return builtins
  }
}
