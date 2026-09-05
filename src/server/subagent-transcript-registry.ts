import type { TranscriptEntry } from "../shared/types"
import { parseAgentTranscriptLines } from "./agent-transcript-parse"
import { readAgentTranscriptLines as defaultRead } from "./subagent-transcript-io.adapter"

export interface SubagentTranscriptRegistry {
  register(chatId: string, subagentsDir: string): void
  unregister(chatId: string): void
  has(chatId: string): boolean
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
      return parseAgentTranscriptLines(read(dir, agentId))
    },
  }
}
