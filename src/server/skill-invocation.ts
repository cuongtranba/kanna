
import type { SlashCommandKind } from "../shared/types"
import type { SkillRosterEntry } from "../shared/kanna-system-prompt"
import {
  buildSlashExpansion,
  parseSlashInvocation,
  type SlashCommandExpansion,
} from "../shared/slash-expansion"
import { log } from "../shared/log"

export interface ResolvedCatalogEntry {
  name: string
  kind: SlashCommandKind
  filePath: string
}

export interface SkillCatalog {
  resolve(cwd: string, name: string): ResolvedCatalogEntry | null
  skills(cwd: string): SkillRosterEntry[]
}

export interface LocalSkillAccess {
  expandSlashCommand(chatId: string, content: string): SlashCommandExpansion | null
  listSkills(chatId: string): SkillRosterEntry[]
}

export function createLocalSkillAccess(
  catalog: SkillCatalog | null,
  resolveChatCwd: (chatId: string) => string | undefined,
  readFileBody: (filePath: string) => string | null,
): LocalSkillAccess {
  const bind = (chatId: string): { catalog: SkillCatalog; cwd: string } | null => {
    if (!catalog) return null
    const cwd = resolveChatCwd(chatId)
    return cwd ? { catalog, cwd } : null
  }

  return {
    expandSlashCommand(chatId, content) {
      const invocation = parseSlashInvocation(content)
      if (!invocation) return null
      const bound = bind(chatId)
      if (!bound) return null
      try {
        const entry = bound.catalog.resolve(bound.cwd, invocation.name)
        if (!entry) return null
        const body = readFileBody(entry.filePath)
        if (body === null) return null
        const prompt = buildSlashExpansion({ source: entry, body, invocation })
        if (prompt.trim().length === 0) return null
        return { prompt, name: entry.name, kind: entry.kind }
      } catch (error) {
        log.warn("[kanna/agent] slash command expansion failed", String(error))
        return null
      }
    },

    listSkills(chatId) {
      const bound = bind(chatId)
      if (!bound) return []
      try {
        return bound.catalog.skills(bound.cwd)
      } catch (error) {
        log.warn("[kanna/agent] skill roster scan failed", String(error))
        return []
      }
    },
  }
}
