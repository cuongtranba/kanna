import type { SlashCommand as SdkSlashCommand } from "@anthropic-ai/claude-agent-sdk"
import type { SlashCommand } from "../shared/types"
import { log } from "../shared/log"
import { toError } from "../shared/errors"

export interface ClaudeCliCommandStore {
  load(): Promise<SlashCommand[]>
  save(commands: readonly SlashCommand[]): Promise<void>
}

export interface ClaudeCliCommands {
  record(rows: readonly SdkSlashCommand[]): void
  list(): SlashCommand[]
}

function toCliCommands(rows: readonly SdkSlashCommand[]): SlashCommand[] {
  return rows
    .filter((row) => row.builtin === true && !row.name.startsWith("_"))
    .map((row) => ({
      name: row.name,
      description: row.description,
      argumentHint: row.argumentHint,
      kind: "command",
      scope: "cli",
    }))
}

export async function openClaudeCliCommands(
  store: ClaudeCliCommandStore,
  onChange: () => void = () => {},
): Promise<ClaudeCliCommands> {
  let commands: SlashCommand[] = []
  try {
    commands = await store.load()
  } catch (error) {
    log.warn("[kanna/cli-commands] load failed", toError(error).message)
  }
  return {
    list: () => [...commands],
    record: (rows) => {
      const next = toCliCommands(rows)
      if (next.length === 0 || JSON.stringify(next) === JSON.stringify(commands)) return
      commands = next
      store.save(next).catch((error) => {
        log.warn("[kanna/cli-commands] save failed", toError(error).message)
      })
      onChange()
    },
  }
}
