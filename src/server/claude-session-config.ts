
import type { McpServerConfig, ProjectInstructionBlock, ResolvedStackBinding } from "../shared/types"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import type { ChatRecord } from "./events"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"


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

export interface ChatCwdStore {
  getChat(chatId: string): Pick<ChatRecord, "id" | "projectId" | "stackBindings"> | null | undefined
  getProject(projectId: string): { localPath: string } | null | undefined
}

export function resolveChatCwd(store: ChatCwdStore, chatId: string): string | undefined {
  const chat = store.getChat(chatId)
  if (!chat) return undefined
  const project = store.getProject(chat.projectId)
  if (!project) return undefined
  return resolveSpawnPaths(chat, project.localPath).cwd
}

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

export const SDK_RESTRICTED_FS_NATIVE_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch"] as const


const TASK_NOTIFICATION_RESULT_MAX_CHARS = 4_000

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
