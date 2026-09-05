import type { SlashCommand } from "../../shared/types"
import type { PluginCommandCenterItem } from "../plugins/contributionRegistry"
import { normalizeCommandName } from "./slash-commands"

const EMPTY_PROMPTS: ReadonlyMap<string, string> = new Map()

export interface PluginCommandMerge {
  readonly commands: SlashCommand[]
  readonly promptByName: ReadonlyMap<string, string>
}

export function pluginCommandName(pluginId: string, name: string): string {
  return `${normalizeCommandName(pluginId)}:${normalizeCommandName(name)}`
}

export function mergePluginCommands(
  catalog: SlashCommand[],
  items: readonly PluginCommandCenterItem[],
): PluginCommandMerge {
  if (items.length === 0) return { commands: catalog, promptByName: EMPTY_PROMPTS }

  const taken = new Set(catalog.map((command) => normalizeCommandName(command.name)))
  const commands = [...catalog]
  const promptByName = new Map<string, string>()

  for (const item of items) {
    const name = pluginCommandName(item.pluginId, item.name)
    if (taken.has(name)) continue
    taken.add(name)
    commands.push({
      name,
      description: item.description,
      argumentHint: "",
      scope: "plugin",
    })
    promptByName.set(name, item.prompt)
  }

  if (promptByName.size === 0) return { commands: catalog, promptByName: EMPTY_PROMPTS }
  return { commands, promptByName }
}
