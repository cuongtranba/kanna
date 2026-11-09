import type { SlashCommand } from "../shared/types"
import { BUILTIN_SLASH_COMMANDS } from "../shared/builtin-commands"
import { log } from "../shared/log"

interface SlashCommandsLocalCatalog {
  list(cwd: string): SlashCommand[]
}

interface SlashCommandsCliCatalog {
  list(): SlashCommand[]
}

export interface SlashCommandsDeps {
  localCatalog: SlashCommandsLocalCatalog | null
  cliCommands?: SlashCommandsCliCatalog | null
}

export function localCommandsForCwd(
  deps: Pick<SlashCommandsDeps, "localCatalog" | "cliCommands">,
  cwd: string,
): SlashCommand[] {
  const kannaBuiltins = [...BUILTIN_SLASH_COMMANDS]
  const builtinNames = new Set(kannaBuiltins.map((command) => command.name.toLowerCase()))
  const cli = (deps.cliCommands?.list() ?? [])
    .filter((command) => !builtinNames.has(command.name.toLowerCase()))
  const builtins = [...kannaBuiltins, ...cli]
  if (!deps.localCatalog) return builtins
  try {
    const disk = deps.localCatalog
      .list(cwd)
      .filter((command) => !builtinNames.has(command.name.toLowerCase()))
    return [...builtins, ...disk]
  } catch (error) {
    log.warn("[kanna/agent] localCatalog.list failed", String(error))
    return builtins
  }
}
