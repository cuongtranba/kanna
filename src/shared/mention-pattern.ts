export const AGENT_MENTION_PATTERN = "(^|[\\s\\n\\t])@agent/([a-z0-9_-]+)"

export function createAgentMentionRegex(): RegExp {
  return new RegExp(AGENT_MENTION_PATTERN, "gi")
}
