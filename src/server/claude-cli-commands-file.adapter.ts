import { isJsonArray, isJsonObject, type JsonValue } from "../shared/json"
import type { SlashCommand } from "../shared/types"
import type { ClaudeCliCommandStore } from "./claude-cli-commands"
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file.adapter"

function normalizeCommands(value: JsonValue): SlashCommand[] {
  if (!isJsonArray(value)) return []
  const commands: SlashCommand[] = []
  for (const row of value) {
    if (!isJsonObject(row)) continue
    const { name, description, argumentHint } = row
    if (typeof name !== "string" || name.length === 0) continue
    commands.push({
      name,
      description: typeof description === "string" ? description : "",
      argumentHint: typeof argumentHint === "string" ? argumentHint : "",
      kind: "command",
      scope: "cli",
    })
  }
  return commands
}

export function createClaudeCliCommandFile(filePath: string): ClaudeCliCommandStore {
  return {
    load: () => readJsonSettingsFile(filePath, {
      label: "Claude CLI commands",
      defaults: () => [],
      normalize: normalizeCommands,
    }),
    save: (commands) => writeJsonSettingsFile(filePath, commands.map((command) => ({
      name: command.name,
      description: command.description,
      argumentHint: command.argumentHint,
    }))),
  }
}
