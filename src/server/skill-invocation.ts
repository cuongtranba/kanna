/**
 * Running a local skill or command on a provider whose harness cannot.
 *
 * The claude CLI resolves `/name` against `.claude/skills` and `.claude/commands`
 * itself. Codex — and anything added after it — receives the literal line and
 * answers it as prose, so every skill on the machine is unreachable there. This
 * module closes that: resolve the name against the catalog Kanna already scans,
 * read the file, and hand back the prompt the provider should run instead. It
 * also answers the other half of the same gap, the roster of skills a model
 * with no skill machinery is told about at session start.
 *
 * Side-effect seal: no IO here. The catalog and the file read arrive as
 * parameters — REQUIRED positional ones rather than an options bundle, so a
 * wiring that forgets one cannot compile (see #893, `deps-bundles`).
 *
 * EVERY failure yields "nothing local", and that means "send what the user
 * typed". A line Kanna cannot resolve is not necessarily a mistake — it may be
 * a path, or a command the provider itself knows — and swallowing the message
 * would be strictly worse than answering it literally. A `.claude` directory
 * that cannot be read costs a skill; failing the send costs the turn.
 */

import type { SlashCommandKind } from "../shared/types"
import type { SkillRosterEntry } from "../shared/kanna-system-prompt"
import {
  buildSlashExpansion,
  parseSlashInvocation,
  type SlashCommandExpansion,
} from "../shared/slash-expansion"
import { log } from "../shared/log"

/** The catalog facts an expansion needs — a structural subset of `RawCatalogEntry`. */
export interface ResolvedCatalogEntry {
  /** Canonical name, which may differ in case from what the user typed. */
  name: string
  kind: SlashCommandKind
  filePath: string
}

/** The catalog surface used here — a structural subset of `LocalCatalogService`. */
export interface SkillCatalog {
  resolve(cwd: string, name: string): ResolvedCatalogEntry | null
  skills(cwd: string): SkillRosterEntry[]
}

export interface LocalSkillAccess {
  /**
   * The prompt a typed `/name args` should run, or `null` when the line names
   * nothing local (and the message is then sent exactly as typed).
   */
  expandSlashCommand(chatId: string, content: string): SlashCommandExpansion | null
  /** Local skills for the chat's cwd, for the roster a non-claude provider is told. */
  listSkills(chatId: string): SkillRosterEntry[]
}

/**
 * Bind the catalog to a chat, resolving its cwd the same way the turn does —
 * so an expansion can never read a different project's `.claude` directory than
 * the turn it is about to start.
 *
 * @param catalog `null` when the server was constructed without one.
 * @param resolveChatCwd `resolveChatCwd` from `claude-session-config.ts`.
 * @param readFileBody `readCatalogFileBody` from the io adapter.
 */
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
        // A file that is only frontmatter would start a turn saying nothing.
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
