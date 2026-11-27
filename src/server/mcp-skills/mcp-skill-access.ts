import type { McpSkillRosterEntry } from "../../shared/kanna-system-prompt"
import { buildMcpSkillInvocation, parseSlashInvocation, type SlashCommandExpansion } from "../../shared/slash-expansion"
import type { McpSkillHost, ReservedSkillNames } from "./mcp-skill-host"

export interface McpSkillAccess {
  host: McpSkillHost
  roster(chatId: string): Promise<McpSkillRosterEntry[]>
  expandSlashCommand(chatId: string, content: string): SlashCommandExpansion | null
}

export function createMcpSkillAccess(host: McpSkillHost, reservedNames: (chatId: string) => ReservedSkillNames): McpSkillAccess {
  return {
    host,
    roster: (chatId) => host.roster(reservedNames(chatId)),
    expandSlashCommand(chatId, content) {
      const invocation = parseSlashInvocation(content)
      if (!invocation) return null
      const entry = host.resolve(invocation.name, reservedNames(chatId))
      if (!entry) return null
      return { prompt: buildMcpSkillInvocation({ entry, invocation }), name: entry.name, kind: "skill" }
    },
  }
}
