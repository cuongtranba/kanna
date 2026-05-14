import type { Subagent } from "../shared/types"

export type ParsedMention =
  | { kind: "subagent"; subagentId: string; raw: string }
  | { kind: "unknown-subagent"; name: string; raw: string }

const AGENT_MENTION_REGEX = /(^|[\s\n\t])@agent\/([a-z0-9_-]+)/gi

export function parseMentions(text: string, subagents: Subagent[]): ParsedMention[] {
  const subagentsByName = new Map<string, Subagent>()
  for (const subagent of subagents) {
    subagentsByName.set(subagent.name.toLowerCase(), subagent)
  }

  const mentions: ParsedMention[] = []
  for (const match of text.matchAll(AGENT_MENTION_REGEX)) {
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
