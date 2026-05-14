// Single source of truth for `@agent/<name>` mention parsing.
// Server is authoritative; the client uses this for picker chips only.
export const AGENT_MENTION_PATTERN = "(^|[\\s\\n\\t])@agent/([a-z0-9_-]+)"

export function createAgentMentionRegex(): RegExp {
  return new RegExp(AGENT_MENTION_PATTERN, "gi")
}
