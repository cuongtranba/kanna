export type ClaudeCredentialKind = "oauth" | "api-key"

const ANTHROPIC_KEY_PREFIX = "sk-ant-"
const OAUTH_TOKEN_PREFIX = "sk-ant-oat"

export function claudeCredentialKind(token: string): ClaudeCredentialKind {
  const trimmed = token.trim()
  if (trimmed.startsWith(OAUTH_TOKEN_PREFIX)) return "oauth"
  return trimmed.startsWith(ANTHROPIC_KEY_PREFIX) ? "api-key" : "oauth"
}
