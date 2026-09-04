import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { JsonValue } from "../shared/json"

/**
 * The MCP call-tool result shape.
 *
 * Derived from the SDK's own `CallToolResult` rather than restated. It used to
 * be restated, and the hand-written index signature (`[key: string]: unknown`)
 * was the whole reason: without it the type is structurally incompatible with
 * what `tool()` expects and every registration fails to infer. Narrowing that
 * signature to a real type is therefore not available — it is the SDK's
 * signature, not ours — so extending is what keeps the interop honest AND keeps
 * an untyped value from being written here.
 *
 * `content` is narrowed to the text-only form every Kanna tool actually emits.
 */
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

/**
 * A tool's parsed arguments.
 *
 * `JsonValue | undefined` rather than `JsonObject`: a schema member declared
 * `z.string().optional()` parses to `string | undefined`, and JSON has no
 * `undefined`. Absent-optional is a real state here, so the type says so
 * instead of pretending every declared argument arrives.
 */
export type ToolArgs = Readonly<Record<string, JsonValue | undefined>>
