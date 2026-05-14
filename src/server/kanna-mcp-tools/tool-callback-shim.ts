import type { ToolCallbackService } from "../tool-callback"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"

export interface ToolHandlerContext {
  chatId: string
  sessionId: string
  toolUseId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
}

export interface ToolHandlerResult {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export interface GatedToolCallArgs {
  toolCallback: ToolCallbackService
  toolName: string
  ctx: ToolHandlerContext
  args: Record<string, unknown>
  formatAnswer: (payload: unknown) => ToolHandlerResult
  formatDeny: (reason: string) => ToolHandlerResult
}

export async function gatedToolCall(args: GatedToolCallArgs): Promise<ToolHandlerResult> {
  const res = await args.toolCallback.submit({
    chatId: args.ctx.chatId,
    sessionId: args.ctx.sessionId,
    toolUseId: args.ctx.toolUseId,
    toolName: args.toolName,
    args: args.args,
    chatPolicy: args.ctx.chatPolicy,
    cwd: args.ctx.cwd,
  })
  if (res.decision.kind === "allow" || res.decision.kind === "answer") {
    return args.formatAnswer(res.decision.payload)
  }
  return args.formatDeny(res.decision.reason ?? "denied")
}
