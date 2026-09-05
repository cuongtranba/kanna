import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { JsonValue } from "../shared/json"

export interface ToolResult extends CallToolResult {
  content: { type: "text"; text: string }[]
  isError?: true
}

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function fail(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

export type ToolArgs = Readonly<Record<string, JsonValue | undefined>>
