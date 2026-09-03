/**
 * Pure, IO-free helpers that configure a Claude session:
 * MCP server wiring, spawn paths, tool constants, and task notifications.
 * Extracted from agent.ts — no dependency on AgentCoordinator or agent.ts.
 */

import type { McpServerConfig, ProjectInstructionBlock, ResolvedStackBinding } from "../shared/types"
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
 * Resolve a chat's stack bindings into named entries.
 *
 * The ONE resolver: both the spawn path (system prompt) and the read model
 * (`deriveChatSnapshot`'s `resolvedBindings`, which the client renders) call
 * this. `read-models.ts` used to carry an inline copy that agreed with it only
 * because `store.getProject` filters `deletedAt`; the two are now the same
 * function, so a caller cannot see a different set of roots than the model does.
 *
 * `lookupProject` reports `active: false` for a project that still has a record
 * but is deleted — the title is kept, because the last known name plus a
 * "missing" status is more use than `(missing)` twice. Returning undefined
 * means no record at all, which is the only case that loses the name.
 *
 * Solo chats (no `stackBindings`) resolve to an empty list — for the
 * instruction blocks a solo chat DOES get, see `resolveProjectInstructions`.
 */
export function resolveStackProjects(
  chat: Pick<ChatRecord, "stackBindings">,
  lookupProject: (projectId: string) => { title: string; active: boolean } | undefined,
): ResolvedStackBinding[] {
  if (!chat.stackBindings || chat.stackBindings.length === 0) return []
  return chat.stackBindings.map((b) => {
    const project = lookupProject(b.projectId)
    return {
      projectId: b.projectId,
      projectTitle: project?.title ?? "(missing)",
      worktreePath: b.worktreePath,
      role: b.role,
      projectStatus: project?.active === true ? "active" : "missing",
    }
  })
}

/**
 * Which projects' instructions apply to this chat's turns.
 *
 * NOT derivable from `resolveStackProjects`: that answers "which roots can
 * this chat reach", and a SOLO chat reaches its project without having a
 * binding for it. Sourcing the blocks from bindings alone would ship a field
 * that is edited from the ordinary project menu but only takes effect inside a
 * stack — so the solo case is synthesized here, once, rather than at each of
 * the three prompt call sites (adr-20260904 D5).
 *
 * `lookupProject` returns undefined for a missing or deleted project, which
 * contributes no block: there is no title to head it with and no rules to
 * state. Projects with no instructions are omitted for the same reason.
 */
export function resolveProjectInstructions(
  chat: Pick<ChatRecord, "projectId" | "stackBindings">,
  lookupProject: (projectId: string) => { title: string; instructions?: string } | undefined,
): ProjectInstructionBlock[] {
  const projectIds = chat.stackBindings && chat.stackBindings.length > 0
    ? chat.stackBindings.map((b) => b.projectId)
    : [chat.projectId]

  const blocks: ProjectInstructionBlock[] = []
  for (const projectId of projectIds) {
    const project = lookupProject(projectId)
    const instructions = project?.instructions?.trim()
    if (!project || !instructions) continue
    blocks.push({ projectId, projectTitle: project.title, instructions })
  }
  return blocks
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
