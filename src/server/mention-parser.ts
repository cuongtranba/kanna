import type { Subagent } from "../shared/types"
import { createAgentMentionRegex } from "../shared/mention-pattern"

export type ParsedMention =
  | { kind: "subagent"; subagentId: string; raw: string }
  | { kind: "unknown-subagent"; name: string; raw: string }

export function parseMentions(text: string, subagents: Subagent[]): ParsedMention[] {
  const subagentsByName = new Map<string, Subagent>()
  for (const subagent of subagents) {
    subagentsByName.set(subagent.name.toLowerCase(), subagent)
  }

  const mentions: ParsedMention[] = []
  for (const match of text.matchAll(createAgentMentionRegex())) {
    const name = match[2]
    if (!name) continue
    const raw = `@agent/${name}`
    const subagent = subagentsByName.get(name.toLowerCase())
    mentions.push(subagent
      ? { kind: "subagent", subagentId: subagent.id, raw }
      : { kind: "unknown-subagent", name, raw })
  }
  return mentions
}
