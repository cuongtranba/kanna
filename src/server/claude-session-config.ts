/**
 * Pure, IO-free helpers that configure a Claude session:
 * MCP server wiring, spawn paths, tool constants, and task notifications.
 * Extracted from agent.ts — no dependency on AgentCoordinator or agent.ts.
 */

import type { McpServerConfig, ResolvedStackBinding } from "../shared/types"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import type { ChatRecord } from "./events"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"

// ---------------------------------------------------------------------------
// MCP server wiring
// ---------------------------------------------------------------------------

type SdkMcpEntry =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers: Record<string, string> }
  | { type: "sse"; url: string; headers: Record<string, string> }
  | { type: "ws"; url: string; headers: Record<string, string> }

export function buildUserMcpServers(
  servers: readonly McpServerConfig[],
  oauthBearers: ReadonlyMap<string, string> = new Map(),
): Record<string, SdkMcpEntry> {
  const out: Record<string, SdkMcpEntry> = {}
  for (const s of servers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    if (s.transport === "stdio") {
      out[s.name] = {
        type: "stdio",
        command: s.command,
        args: s.args,
        env: s.env,
        ...(s.cwd ? { cwd: s.cwd } : {}),
      }
    } else {
      const bearer = oauthBearers.get(s.id)
      const headers = bearer ? { ...s.headers, Authorization: `Bearer ${bearer}` } : s.headers
      out[s.name] = {
        type: s.transport,
        url: s.url,
        headers,
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Spawn path resolution
// ---------------------------------------------------------------------------

export function resolveSpawnPaths(
  chat: Pick<ChatRecord, "id" | "stackBindings">,
  fallbackLocalPath: string,
): { cwd: string; additionalDirectories: string[] } {
  if (!chat.stackBindings || chat.stackBindings.length === 0) {
    return { cwd: fallbackLocalPath, additionalDirectories: [] }
  }
  const primary = chat.stackBindings.find((b) => b.role === "primary")
  if (!primary) {
    throw new Error(`Chat ${chat.id} has stackBindings but no primary`)
  }
  const additionalDirectories = chat.stackBindings
    .filter((b) => b.role === "additional")
    .map((b) => b.worktreePath)
  return { cwd: primary.worktreePath, additionalDirectories }
}

/**
 * Resolve a chat's stack bindings into named entries for the system prompt.
 * Mirrors the read-model resolver in `read-models.ts` — looks each binding's
 * project title up via `lookupProjectTitle`, falling back to `(missing)` /
 * `projectStatus: "missing"` when the project no longer exists. Solo chats
 * (no `stackBindings`) resolve to an empty list (no prompt block).
 */
export function resolveStackProjects(
  chat: Pick<ChatRecord, "stackBindings">,
  lookupProjectTitle: (projectId: string) => string | undefined,
): ResolvedStackBinding[] {
  if (!chat.stackBindings || chat.stackBindings.length === 0) return []
  return chat.stackBindings.map((b) => {
    const title = lookupProjectTitle(b.projectId)
    return {
      projectId: b.projectId,
      projectTitle: title ?? "(missing)",
      worktreePath: b.worktreePath,
      role: b.role,
      projectStatus: title !== undefined ? "active" : "missing",
    }
  })
}

// ---------------------------------------------------------------------------
// Tool constants
// ---------------------------------------------------------------------------

export const CLAUDE_TOOLSET = [
  "Skill",
  "WebFetch",
  "WebSearch",
  "Task",
  "TaskOutput",
  "Workflow",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "TodoWrite",
  "KillShell",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
] as const

/** Native FS tools the SDK driver disallows when a subagent is folder-restricted. */
export const SDK_RESTRICTED_FS_NATIVE_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch"] as const

// ---------------------------------------------------------------------------
// Task notification
// ---------------------------------------------------------------------------

/** Cap on the <result> body inside a task-notification — bounds re-entry prompt size. */
const TASK_NOTIFICATION_RESULT_MAX_CHARS = 4_000

/**
 * Render a background-subagent outcome as the `<task-notification>` XML that
 * Claude Code's own LocalAgentTask uses for background-agent completion, so
 * the model parses task identity/status with a format it natively knows.
 * `includeResult: false` (armed loops) omits the result body — PROGRESS.md is
 * the loop's durability contract, not the re-entry prompt.
 */
export function buildTaskNotification(
  runId: string,
  outcome: BackgroundRunOutcome,
  opts: { includeResult: boolean },
): string {
  const status = outcome.status === "completed" ? "completed" : "failed"
  const summary = outcome.status === "completed"
    ? `Background subagent run ${runId} completed`
    : `Background subagent run ${runId} failed (${outcome.errorCode}): ${outcome.errorMessage}`
  let resultSection = ""
  if (opts.includeResult) {
    const body = outcome.status === "completed" ? outcome.text : outcome.errorMessage
    const trimmed = body.length > TASK_NOTIFICATION_RESULT_MAX_CHARS
      ? `${body.slice(0, TASK_NOTIFICATION_RESULT_MAX_CHARS)}\n[... truncated]`
      : body
    if (trimmed) resultSection = `\n<result>${trimmed}</result>`
  }
  return `<task-notification>
<task-id>${runId}</task-id>
<status>${status}</status>
<summary>${summary}</summary>${resultSection}
</task-notification>`
}
