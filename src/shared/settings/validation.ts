export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/
export const MCP_RESERVED_NAMES: ReadonlySet<string> = new Set(["kanna"])

export type McpServerNameIssue = "INVALID_NAME" | "RESERVED_NAME"

export function mcpServerNameIssue(name: string): McpServerNameIssue | null {
  if (!MCP_SERVER_NAME_PATTERN.test(name)) return "INVALID_NAME"
  if (MCP_RESERVED_NAMES.has(name)) return "RESERVED_NAME"
  return null
}

export const SNIPPET_SHORTCUT_PATTERN = /^\S{1,32}$/

export const SUBAGENT_NAME_PATTERN = /^[a-z0-9_-]+$/
export const SUBAGENT_NAME_DISALLOWED_RUN = /[^a-z0-9_-]+/g
export const SUBAGENT_NAME_MAX = 64
