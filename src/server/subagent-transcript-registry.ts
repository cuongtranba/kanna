import type { TranscriptEntry } from "../shared/types"
import { normalizeClaudeStreamMessage } from "./agent"
import { readAgentTranscriptLines as defaultRead } from "./subagent-transcript-io.adapter"

export interface SubagentTranscriptRegistry {
  /** Bind a chat to the `<projectDir>/<claude-uuid>/subagents` dir. */
  register(chatId: string, subagentsDir: string): void
  unregister(chatId: string): void
  /** Whether a chat currently has a registered subagents dir (live or lazily derived). */
  has(chatId: string): boolean
  /**
   * Read + parse `subagents/agent-<agentId>.jsonl` into transcript entries.
   * Returns [] for an unknown chat or a missing file. Parses each line with
   * `normalizeClaudeStreamMessage` directly — NOT `createJsonlEventParser`,
   * which drops `isSidechain:true` lines (the agent files are entirely
   * sidechain), and never feeds the turn/event pipeline (c3-225).
   */
  getAgentTranscript(chatId: string, agentId: string): TranscriptEntry[]
}

export interface SubagentTranscriptRegistryDeps {
  readAgentTranscriptLines?: (subagentsDir: string, agentId: string) => string[]
}

export function createSubagentTranscriptRegistry(
  deps: SubagentTranscriptRegistryDeps = {},
): SubagentTranscriptRegistry {
  const read = deps.readAgentTranscriptLines ?? defaultRead
  const dirByChat = new Map<string, string>()

  return {
    register(chatId, subagentsDir) {
      dirByChat.set(chatId, subagentsDir)
    },
    unregister(chatId) {
      dirByChat.delete(chatId)
    },
    has(chatId) {
      return dirByChat.has(chatId)
    },
    getAgentTranscript(chatId, agentId) {
      const dir = dirByChat.get(chatId)
      if (dir === undefined) return []
      const out: TranscriptEntry[] = []
      for (const line of read(dir, agentId)) {
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch {
          continue // partial / corrupt line — skip
        }
        if (!parsed || typeof parsed !== "object") continue
        try {
          out.push(...normalizeClaudeStreamMessage(parsed))
        } catch {
          continue // defensive: never let one bad line abort the read
        }
      }
      return out
    },
  }
}
