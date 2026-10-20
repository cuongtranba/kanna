import type { InboundHandler } from "../inbound/handler"
import type { JsonObject, JsonValue } from "../json"

export type McpSourceMode = "subscribe" | "poll"

export const MCP_SOURCE_MODES: readonly McpSourceMode[] = ["subscribe", "poll"]

export const MCP_SOURCE_INTERVAL_MIN_MS = 5000
export const MCP_SOURCE_INTERVAL_MAX_MS = 3_600_000
export const MCP_SOURCE_DEDUPE_KEYS = 256
export const MCP_SOURCE_NAME_MAX = 80
export const MCP_SOURCE_TEMPLATE_MAX = 8000
export const MCP_SOURCE_REPLY_HINT_MAX = 2000
export const MCP_SOURCE_PATH_MAX = 200

export interface McpSourceBase {
  id: string
  name: string
  serverId: string
  enabled: boolean
  threadKeyPath: string
  senderPath: string
  handler: InboundHandler
  createdAt: number
  updatedAt: number
}

export interface McpSubscribeSource extends McpSourceBase {
  mode: "subscribe"
  resourceUris: string[]
}

export interface McpPollSource extends McpSourceBase {
  mode: "poll"
  tool: string
  args: JsonObject
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string | null
  intervalMs: number
}

export type McpSource = McpSubscribeSource | McpPollSource

interface McpSourceInputBase {
  name: string
  serverId: string
  enabled?: boolean
  threadKeyPath: string
  senderPath: string
  handler: InboundHandler
}

export type McpSourceInput =
  | (McpSourceInputBase & { mode: "subscribe"; resourceUris: string[] })
  | (McpSourceInputBase & {
      mode: "poll"
      tool: string
      args: JsonObject
      cursorArg: string
      cursorPath: string
      itemsPath: string
      itemKeyPath: string | null
      intervalMs: number
    })

export type McpSourcePatch = Partial<{
  name: string
  serverId: string
  enabled: boolean
  mode: McpSourceMode
  threadKeyPath: string
  senderPath: string
  handler: InboundHandler
  resourceUris: string[]
  tool: string
  args: JsonObject
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string | null
  intervalMs: number
}>

export type McpSourceState = "disabled" | "connecting" | "listening" | "polling" | "backoff" | "error"

export interface McpSourceStatus {
  id: string
  state: McpSourceState
  lastError: string | null
  lastItemAt: number | null
  itemCount: number
  honoredUris?: string[]
  cursor?: JsonValue
  nextAt?: number
}

export interface McpSourcesSnapshot {
  sources: McpSourceStatus[]
}

export function isMcpSourceMode(value: string): value is McpSourceMode {
  return MCP_SOURCE_MODES.some((mode) => mode === value)
}

export function clampMcpSourceInterval(intervalMs: number): number {
  return Math.min(MCP_SOURCE_INTERVAL_MAX_MS, Math.max(MCP_SOURCE_INTERVAL_MIN_MS, Math.round(intervalMs)))
}
