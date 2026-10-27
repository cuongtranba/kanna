import { tool } from "@anthropic-ai/claude-agent-sdk"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { JsonObject } from "../../shared/json"
import type { KannaSdkTool, KannaToolFactory } from "../kanna-mcp-tool"

export const sdkToolFactory: KannaToolFactory<KannaSdkTool> = tool

export function invokeTool(entry: KannaSdkTool, input: JsonObject = {}, extra?: object): Promise<CallToolResult> {
  return entry.handler(input, extra)
}

export function toolText(result: CallToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n")
}
