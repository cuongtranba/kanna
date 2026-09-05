
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessToolRequest } from "./harness-types"
import { normalizeToolCall } from "../shared/tools"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import { toJsonObject } from "./json-boundary"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"

export const LOOP_BLOCKED_NATIVE_TOOLS: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
]

export interface BuildCanUseToolArgs {
  localPath: string
  chatId?: string
  sessionToken?: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  isLoopArmed?: () => boolean
}

export function buildCanUseTool(
  args: BuildCanUseToolArgs,
): (...params: Parameters<CanUseTool>) => Promise<PermissionResult> {
  return async (toolName, input, options) => {
    if (args.isLoopArmed?.() && LOOP_BLOCKED_NATIVE_TOOLS.includes(toolName)) {
      return {
        behavior: "deny",
        message:
          `${toolName} is blocked while an autonomous loop is armed. You are the `
          + "orchestrator: delegate the next chunk with delegate_subagent "
          + "(run_in_background: true) and end your turn, or call stop_loop if the "
          + "goal is met. Do not edit files directly.",
      }
    }

    if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      return { behavior: "allow", updatedInput: input }
    }

    const tool = normalizeToolCall({
      toolName,
      toolId: options.toolUseID,
      input: toJsonObject(input ?? {}),
    })

    if (tool.toolKind !== "ask_user_question" && tool.toolKind !== "exit_plan_mode") {
      return { behavior: "deny", message: "Unsupported tool request" }
    }

    if (process.env.KANNA_MCP_TOOL_CALLBACKS === "1" && args.toolCallback) {
      const result = await args.toolCallback.submit({
        chatId: args.chatId ?? "",
        sessionId: args.sessionToken ?? "",
        toolUseId: options.toolUseID,
        toolName: `mcp__kanna__${tool.toolKind}`,
        args: tool.rawInput ?? {},
        chatPolicy: args.chatPolicy ?? POLICY_DEFAULT,
        cwd: args.localPath,
      })

      if (result.decision.kind === "deny") {
        return { behavior: "deny", message: result.decision.reason ?? "denied" }
      }

      const rawPayload = result.decision.payload ?? null
      const payload: JsonObject = isJsonObject(rawPayload) ? rawPayload : {}

      if (tool.toolKind === "ask_user_question") {
        return {
          behavior: "allow",
          updatedInput: {
            ...(tool.rawInput ?? {}),
            questions: payload.questions ?? tool.input.questions,
            answers: payload.answers ?? result.decision.payload,
          },
        } satisfies PermissionResult
      }

      if (payload.confirmed) {
        return {
          behavior: "allow",
          updatedInput: { ...(tool.rawInput ?? {}), ...payload },
        } satisfies PermissionResult
      }

      return {
        behavior: "deny",
        message: typeof payload.message === "string"
          ? `User wants to suggest edits to the plan: ${payload.message}`
          : "User wants to suggest edits to the plan before approving.",
      } satisfies PermissionResult
    }

    const result = await args.onToolRequest({ tool })

    if (isJsonObject(result) && result.discarded === true) {
      return {
        behavior: "deny",
        message: "The user cancelled this turn before answering.",
      } satisfies PermissionResult
    }

    if (tool.toolKind === "ask_user_question") {
      const record: JsonObject = isJsonObject(result) ? result : {}
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          questions: record.questions ?? tool.input.questions,
          answers: record.answers ?? result,
        },
      } satisfies PermissionResult
    }

    const record: JsonObject = isJsonObject(result) ? result : {}
    const confirmed = Boolean(record.confirmed)
    if (confirmed) {
      return {
        behavior: "allow",
        updatedInput: { ...(tool.rawInput ?? {}), ...record },
      } satisfies PermissionResult
    }

    return {
      behavior: "deny",
      message: typeof record.message === "string"
        ? `User wants to suggest edits to the plan: ${record.message}`
        : "User wants to suggest edits to the plan before approving.",
    } satisfies PermissionResult
  }
}

export const ADDITIONAL_DIRECTORY_MEMORY_ENV = "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD"

export function withAdditionalDirectoryMemory(
  env: NodeJS.ProcessEnv,
  additionalDirectories: readonly string[] | undefined,
): NodeJS.ProcessEnv {
  if (!additionalDirectories || additionalDirectories.length === 0) return env
  if (env.KANNA_STACK_MEMORY === "disabled") return env
  return { ...env, [ADDITIONAL_DIRECTORY_MEMORY_ENV]: "1" }
}

export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  oauthToken: string | null,
  openrouter?: { apiKey: string } | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, CLAUDE_CODE_OAUTH_TOKEN: _oauth, ...rest } = baseEnv
  if (openrouter) {
    return {
      ...rest,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: openrouter.apiKey,
      ANTHROPIC_API_KEY: "",
    }
  }
  if (!oauthToken) {
    return baseEnv.CLAUDE_CODE_OAUTH_TOKEN
      ? { ...rest, CLAUDE_CODE_OAUTH_TOKEN: baseEnv.CLAUDE_CODE_OAUTH_TOKEN }
      : rest
  }
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
}
