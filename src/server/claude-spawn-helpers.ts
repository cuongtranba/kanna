
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessToolRequest } from "./harness-types"
import { normalizeToolCall } from "../shared/tools"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import { toJsonObject } from "./json-boundary"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import { projectProcessEnv } from "./project-process-env"
import type { SdkEndpointEnv } from "./sdk-endpoint"

export const LOOP_BLOCKED_NATIVE_TOOLS: readonly string[] = [
  "Edit",
  "Write",
  "NotebookEdit",
  "Task",
  "Agent",
]

export const LOOP_BLOCKED_TOOL_MESSAGE =
  "is blocked while an autonomous loop is armed. You are the "
  + "orchestrator: delegate the next chunk with delegate_subagent "
  + "(run_in_background: true) and end your turn, or call stop_loop if the "
  + "goal is met. Do not edit files directly."

export interface BuildCanUseToolArgs {
  localPath: string
  chatId?: string
  sessionToken?: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
}

export interface PlanDecision {
  confirmed: boolean
  clearContext: boolean
  message: string | undefined
}

export function readPlanDecision(payload: JsonValue | undefined): PlanDecision {
  const record: JsonObject = payload !== undefined && isJsonObject(payload) ? payload : {}
  return {
    confirmed: Boolean(record.confirmed),
    clearContext: Boolean(record.clearContext),
    message: typeof record.message === "string" ? record.message : undefined,
  }
}

function permissionResultFor(
  tool: HarnessToolRequest["tool"],
  payload: JsonValue | undefined,
): PermissionResult {
  const record: JsonObject = payload !== undefined && isJsonObject(payload) ? payload : {}
  if (tool.toolKind === "ask_user_question") {
    return {
      behavior: "allow",
      updatedInput: {
        ...(tool.rawInput ?? {}),
        questions: record.questions ?? tool.input.questions,
        answers: record.answers ?? payload,
      },
    }
  }
  const { confirmed, message } = readPlanDecision(payload)
  if (confirmed) {
    return { behavior: "allow", updatedInput: { ...(tool.rawInput ?? {}), ...record } }
  }
  return {
    behavior: "deny",
    message: message === undefined
      ? "User wants to suggest edits to the plan before approving."
      : `User wants to suggest edits to the plan: ${message}`,
  }
}

export function buildCanUseTool(
  args: BuildCanUseToolArgs,
): (...params: Parameters<CanUseTool>) => Promise<PermissionResult> {
  return async (toolName, input, options) => {
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

      return permissionResultFor(tool, result.decision.payload)
    }

    const result = await args.onToolRequest({ tool })

    if (isJsonObject(result) && result.discarded === true) {
      return {
        behavior: "deny",
        message: "The user cancelled this turn before answering.",
      } satisfies PermissionResult
    }

    return permissionResultFor(tool, result)
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

export const CLAUDE_MODEL_ALIAS_ENV_VARS: readonly string[] = [
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
]

export const CLAUDE_MAX_CONTEXT_TOKENS_ENV = "CLAUDE_CODE_MAX_CONTEXT_TOKENS"

function endpointModelEnv({ aliasModel, contextWindow }: SdkEndpointEnv): NodeJS.ProcessEnv {
  const aliases = aliasModel === null
    ? {}
    : Object.fromEntries(CLAUDE_MODEL_ALIAS_ENV_VARS.map((name) => [name, aliasModel]))
  const window = contextWindow === null ? {} : { [CLAUDE_MAX_CONTEXT_TOKENS_ENV]: String(contextWindow) }
  return { ...aliases, ...window }
}

export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  oauthToken: string | null,
  endpoint?: SdkEndpointEnv | null,
  anthropicBaseUrl?: string | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, CLAUDE_CODE_OAUTH_TOKEN: _oauth, ...rest } = projectProcessEnv(baseEnv)
  if (endpoint) {
    return {
      ...rest,
      ANTHROPIC_BASE_URL: endpoint.baseUrl,
      ANTHROPIC_AUTH_TOKEN: endpoint.apiKey,
      ANTHROPIC_API_KEY: "",
      ...endpointModelEnv(endpoint),
    }
  }
  const scoped = anthropicBaseUrl
    ? { ...rest, ANTHROPIC_BASE_URL: anthropicBaseUrl }
    : rest
  if (!oauthToken) {
    return baseEnv.CLAUDE_CODE_OAUTH_TOKEN
      ? { ...scoped, CLAUDE_CODE_OAUTH_TOKEN: baseEnv.CLAUDE_CODE_OAUTH_TOKEN }
      : scoped
  }
  return { ...scoped, CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
}
