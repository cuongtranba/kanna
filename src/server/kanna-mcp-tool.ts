import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { createSdkMcpServer, InferShape } from "@anthropic-ai/claude-agent-sdk"
import type { z } from "zod"

export interface ToolResult extends CallToolResult {
  content: { type: "text"; text: string }[]
  isError?: true
}

export type KannaSdkToolList = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>

export type KannaSdkTool = KannaSdkToolList[number]

export type SdkToolExtra = Parameters<KannaSdkTool["handler"]>[1]

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function fail(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

export function requireNonBlank(value: string, name: string): string {
  if (value.trim() === "") throw new Error(`${name} is required`)
  return value
}

export type ToolInput<TShape extends z.ZodRawShape> = InferShape<TShape>

export type KannaToolFactory<TTool, TExtra = SdkToolExtra> = <TShape extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: TShape,
  handler: (input: ToolInput<TShape>, extra?: TExtra) => Promise<ToolResult>,
) => TTool
