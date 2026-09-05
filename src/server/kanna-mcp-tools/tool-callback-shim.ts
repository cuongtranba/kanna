import type { ToolCallbackService } from "../tool-callback"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"

export interface ToolHandlerContext {
  chatId: string
  sessionId: string
  toolUseId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
  restrictedAllowedPaths?: readonly string[]
}

export interface ToolHandlerResult {
  [key: string]: JsonValue | undefined
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export interface GatedToolCallArgs {
  toolCallback: ToolCallbackService
  toolName: string
  ctx: ToolHandlerContext
  args: JsonValue
  formatAnswer: (payload: JsonValue | undefined) => ToolHandlerResult | Promise<ToolHandlerResult>
  formatDeny: (reason: string) => ToolHandlerResult
}

export async function gatedToolCall(args: GatedToolCallArgs): Promise<ToolHandlerResult> {
  const submitArgs: JsonObject = isJsonObject(args.args) ? args.args : {}
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
