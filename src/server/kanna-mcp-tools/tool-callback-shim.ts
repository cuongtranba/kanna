import type { z } from "zod"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"
import { kannaToolName } from "../../shared/tools"
import { toJsonObject } from "../json-boundary"
import { fail, type KannaToolFactory, type SdkToolExtra, type ToolInput, type ToolResult } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"

export interface ToolHandlerContext {
  chatId: string
  sessionId: string
  toolUseId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
  restrictedAllowedPaths?: readonly string[]
}

export interface BuiltinShim {
  readonly name: string
  register<TTool>(factory: KannaToolFactory<TTool>, contextOf: (extra: SdkToolExtra) => ToolHandlerContext): TTool
}

export interface GatedTool<TShape extends z.ZodRawShape> extends BuiltinShim {
  readonly shape: TShape
  handler(input: ToolInput<TShape>, ctx: ToolHandlerContext): Promise<ToolResult>
}

export interface GatedToolSpec<TShape extends z.ZodRawShape> {
  name: string
  shape: TShape
  run(input: ToolInput<TShape>, ctx: ToolHandlerContext): Promise<ToolResult>
}

export function defineGatedTool<TShape extends z.ZodRawShape>(
  deps: { toolCallback: ToolCallbackService },
  spec: GatedToolSpec<TShape>,
): GatedTool<TShape> {
  async function handler(input: ToolInput<TShape>, ctx: ToolHandlerContext): Promise<ToolResult> {
    const { decision } = await deps.toolCallback.submit({
      chatId: ctx.chatId,
      sessionId: ctx.sessionId,
      toolUseId: ctx.toolUseId,
      toolName: kannaToolName(spec.name),
      args: toJsonObject(input),
      chatPolicy: ctx.chatPolicy,
      cwd: ctx.cwd,
      restrictedAllowedPaths: ctx.restrictedAllowedPaths,
    })
    if (decision.kind === "allow" || decision.kind === "answer") return spec.run(input, ctx)
    return fail(`Denied: ${decision.reason ?? "denied"}`)
  }

  return {
    name: spec.name,
    shape: spec.shape,
    handler,
    register: (factory, contextOf) =>
      factory(
        spec.name,
        `Kanna built-in replacement for ${spec.name}.`,
        spec.shape,
        (input, extra) => handler(input, contextOf(extra)),
      ),
  }
}
