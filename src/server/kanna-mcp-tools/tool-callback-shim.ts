import type { ToolCallbackService } from "../tool-callback"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"
import type { AnyValue } from "../../shared/errors"
import { isRecord } from "../../shared/errors"

export interface ToolHandlerContext {
  chatId: string
  sessionId: string
  toolUseId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
  /** Folder-restricted subagent: per-run absolute path-root allowlist. Undefined = no extra check. */
  restrictedAllowedPaths?: readonly string[]
}

export interface ToolHandlerResult {
  // Index signature required to satisfy MCP CallToolResult shape
  [key: string]: AnyValue
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export interface GatedToolCallArgs {
  toolCallback: ToolCallbackService
  toolName: string
  ctx: ToolHandlerContext
  args: AnyValue
  formatAnswer: (payload: AnyValue) => ToolHandlerResult | Promise<ToolHandlerResult>
  formatDeny: (reason: string) => ToolHandlerResult
}

export async function gatedToolCall(args: GatedToolCallArgs): Promise<ToolHandlerResult> {
  const submitArgs: Record<string, AnyValue> = isRecord(args.args) ? args.args : {}
  const res = await args.toolCallback.submit({
    chatId: args.ctx.chatId,
    sessionId: args.ctx.sessionId,
    toolUseId: args.ctx.toolUseId,
    toolName: args.toolName,
    args: submitArgs,
    chatPolicy: args.ctx.chatPolicy,
    cwd: args.ctx.cwd,
    restrictedAllowedPaths: args.ctx.restrictedAllowedPaths,
  })
  if (res.decision.kind === "allow" || res.decision.kind === "answer") {
    return await args.formatAnswer(res.decision.payload)
  }
  return args.formatDeny(res.decision.reason ?? "denied")
}
