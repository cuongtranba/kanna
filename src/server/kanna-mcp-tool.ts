import type { AnyValue } from "../shared/errors"

/**
 * The MCP call-tool result shape. The index signature is what the SDK's
 * `tool()` expects of a `CallToolResult`; without it this type is
 * structurally incompatible and every registration fails to infer.
 */
export interface ToolResult {
  content: { type: "text"; text: string }[]
  isError?: true
  [key: string]: AnyValue
}

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function fail(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}
