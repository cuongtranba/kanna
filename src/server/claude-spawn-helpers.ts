/**
 * Spawn-preparation helpers for Claude SDK / PTY sessions.
 *
 * Pure module — no IO, no `*.adapter.ts` suffix needed.
 * Extracted from agent.ts to keep that file under the 600-LOC target.
 */

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessToolRequest } from "./harness-types"
import { normalizeToolCall } from "../shared/tools"
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import { toJsonObject } from "./json-boundary"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"

/**
 * Native tools blocked while an autonomous loop is armed on the chat. The loop
 * orchestrator must delegate every code change to a subagent (fresh context
 * each iteration); letting it edit directly is exactly the drift that produced
 * the 7.5h marathon turn. `Task` (the native Agent tool) is blocked too — it
 * runs inline in the same turn with no /clear.
 */
export const LOOP_BLOCKED_NATIVE_TOOLS: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
]

/** Args for the `buildCanUseTool` helper — exposed for unit testing. */
export interface BuildCanUseToolArgs {
  localPath: string
  chatId?: string
  sessionToken?: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  /** When present and returns true, block LOOP_BLOCKED_NATIVE_TOOLS (loop-armed turn). */
  isLoopArmed?: () => boolean
}

/**
 * Builds the `canUseTool` callback passed to the SDK `query()`.
 * Exported so unit tests can exercise the dual-routing logic without
 * going through the full `startClaudeSession` factory.
 */
// Return type is narrowed from the SDK's `Promise<PermissionResult | null>`:
// this callback always answers (never suppresses the control response), so
// callers — including tests — get a non-null PermissionResult.
export function buildCanUseTool(
  args: BuildCanUseToolArgs,
): (...params: Parameters<CanUseTool>) => Promise<PermissionResult> {
  return async (toolName, input, options) => {
    // Loop-armed turns: the orchestrator may only Read/Bash(verify)/delegate.
    // Block direct edits + the native Agent tool so it cannot self-implement.
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

    // ── Flag-on path: route through tool-callback ──────────────────────────
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

      // exit_plan_mode
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

    // ── Legacy path (flag off OR toolCallback not provided) ────────────────
    const result = await args.onToolRequest({ tool })

    // cancelChat settles a parked pendingTool with `{discarded:true}` so the
    // worker is never left blocked. That is NOT an answer: without this guard
    // the ask_user_question branch below maps it to `behavior:"allow"` with
    // empty answers, the SDK actually executes the tool, and its own
    // tool_result overwrites the "Discarded" marker already written to the
    // transcript. Deny instead — the tool never runs.
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

/**
 * Claude Code's own switch for loading memory files from `--add-dir` roots.
 * Without it a root is writable but its `CLAUDE.md`, `.claude/CLAUDE.md`,
 * `.claude/rules/*.md` and `CLAUDE.local.md` are never read.
 */
export const ADDITIONAL_DIRECTORY_MEMORY_ENV = "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD"

/**
 * Load every bound root's conventions when a spawn can write every bound root.
 *
 * A stack chat gets one `--add-dir` per additional project, which grants full
 * write access; without this variable it has that access while knowing none of
 * those projects' rules. The cost is real — every added root's memory files
 * are spent from every turn's context — which is why this is gated on there
 * BEING additional roots: a solo chat's context is byte-for-byte unchanged.
 *
 * `KANNA_STACK_MEMORY=disabled` opts out. It is read from the passed
 * environment rather than the global so this stays pure and injectable; both
 * call sites hand in an environment derived from `process.env`.
 *
 * Applied by both drivers — SDK at `claude-session-start.ts`, PTY at
 * `claude-pty/driver.ts` — so the two cannot drift.
 */
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
    // OpenRouter's Anthropic-compatible endpoint. ANTHROPIC_API_KEY MUST be
    // explicitly empty or the SDK prefers it over the auth token and 401s.
    return {
      ...rest,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: openrouter.apiKey,
      ANTHROPIC_API_KEY: "",
    }
  }
  // Empty string is treated the same as null. Blank tokens are rejected at persistence time
  // by normalizeTokenEntry, so in practice oauthToken is either a non-empty string or null.
  if (!oauthToken) {
    return baseEnv.CLAUDE_CODE_OAUTH_TOKEN
      ? { ...rest, CLAUDE_CODE_OAUTH_TOKEN: baseEnv.CLAUDE_CODE_OAUTH_TOKEN }
      : rest
  }
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
}
