import type { McpSourceMode, McpSourceState } from "../../shared/mcp-sources/types"
import type { StatusTone } from "./statusLabel"

const STATE_LABEL: Readonly<Record<McpSourceState, string>> = {
  disabled: "Disabled",
  connecting: "Connecting",
  listening: "Listening",
  polling: "Polling",
  backoff: "Retrying",
  error: "Error",
}

const STATE_TONE: Readonly<Record<McpSourceState, StatusTone>> = {
  disabled: "muted",
  connecting: "attention",
  listening: "muted",
  polling: "muted",
  backoff: "attention",
  error: "destructive",
}

const MODE_LABEL: Readonly<Record<McpSourceMode, string>> = {
  subscribe: "Subscribe",
  poll: "Poll",
}

const MODE_CONSEQUENCE: Readonly<Record<McpSourceMode, string>> = {
  subscribe: "Kanna listens for change notifications on the resources you name and reads each one that changes.",
  poll: "Kanna calls a tool on an interval and remembers a cursor, so each message is delivered once.",
}

export function mcpSourceStateLabel(state: McpSourceState): string {
  return STATE_LABEL[state]
}

export function mcpSourceStateTone(state: McpSourceState): StatusTone {
  return STATE_TONE[state]
}

export function mcpSourceModeLabel(mode: McpSourceMode): string {
  return MODE_LABEL[mode]
}

export function mcpSourceModeConsequence(mode: McpSourceMode): string {
  return MODE_CONSEQUENCE[mode]
}
