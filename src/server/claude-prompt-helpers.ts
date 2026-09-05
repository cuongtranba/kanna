
import type { ChatAttachment, NormalizedToolCall } from "../shared/types"
import type { SessionBackgroundTask } from "./claude-session-state"
import { isRecord } from "../shared/errors"


function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}


export function buildAttachmentHintText(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return ""

  const lines = attachments.map((attachment) => (
    `<attachment kind="${escapeXmlAttribute(attachment.kind)}" mime_type="${escapeXmlAttribute(attachment.mimeType)}" path="${escapeXmlAttribute(attachment.absolutePath)}" project_path="${escapeXmlAttribute(attachment.relativePath)}" size_bytes="${attachment.size}" display_name="${escapeXmlAttribute(attachment.displayName)}" />`
  ))

  return [
    "<kanna-attachments>",
    ...lines,
    "</kanna-attachments>",
  ].join("\n")
}

export function buildPromptText(content: string, attachments: ChatAttachment[]) {
  const attachmentHint = buildAttachmentHintText(attachments)
  if (!attachmentHint) {
    return content.trim()
  }

  const trimmed = content.trim()
  return [
    trimmed || "Please inspect the attached files.",
    attachmentHint,
  ].join("\n\n").trim()
}


const STEERED_MESSAGE_PREFIX = `<system-message>
The user would like to inform you of something while you continue to work. Acknowledge receipt immediately with a text response, then continue with the task at hand, incorporating the user's feedback if needed.
</system-message>`

export function buildSteeredMessageContent(content: string) {
  return content.trim().length > 0
    ? `${STEERED_MESSAGE_PREFIX}\n\n${content}`
    : STEERED_MESSAGE_PREFIX
}


export function isPromptTooLongMessage(message: string): boolean {
  return /\bprompt\b.*\btoo\s+long\b/i.test(message)
    || /\bprompt\b.*\btoo\s+large\b/i.test(message)
}

export function isNoConversationFoundMessage(message: string): boolean {
  return /No conversation found with session ID/i.test(message)
}


export function toSdkEffort(effort: string | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max") {
    return effort
  }
  return undefined
}


const BACKGROUND_TASK_LAUNCH_RE =
  /Command running in background with ID:\s*(\w+)\.?\s*(?:Output is being written to:\s*(.+?)(?=\. [A-Z]|\n|$))?/g

const ASYNC_AGENT_LAUNCH_MARKER = "Async agent launched successfully"
const ASYNC_AGENT_ID_RE = /agentId:\s*(\w+)/g

export interface BackgroundTaskLaunch {
  id: string
  outputPath: string | null
}

function toolResultText<T>(content: T): string | null {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    let text = ""
    for (const block of content) {
      if (isRecord(block)) {
        const blockText = block.text
        if (typeof blockText === "string") text += `${blockText}\n`
      }
    }
    return text
  }
  return null
}

export function backgroundTaskLaunchesFromToolResult<T>(content: T): BackgroundTaskLaunch[] {
  const text = toolResultText(content)
  if (text === null) return []
  const launches: BackgroundTaskLaunch[] = []
  for (const match of text.matchAll(BACKGROUND_TASK_LAUNCH_RE)) {
    if (match[1]) {
      launches.push({ id: match[1], outputPath: match[2]?.trim() ?? null })
    }
  }
  if (text.includes(ASYNC_AGENT_LAUNCH_MARKER)) {
    const seen = new Set(launches.map((l) => l.id))
    for (const match of text.matchAll(ASYNC_AGENT_ID_RE)) {
      if (match[1] && !seen.has(match[1])) {
        launches.push({ id: match[1], outputPath: null })
        seen.add(match[1])
      }
    }
  }
  return launches
}

export function backgroundTaskIdsFromToolResult<T>(content: T): string[] {
  return backgroundTaskLaunchesFromToolResult(content).map((l) => l.id)
}

export function toolCallDescription(tool: NormalizedToolCall): string | null {
  if (tool.toolKind === "bash") {
    const description = tool.input.description ?? tool.input.command
    return typeof description === "string" && description.length > 0 ? description : null
  }
  const raw = tool.rawInput?.description
  return typeof raw === "string" && raw.length > 0 ? raw : null
}

export function mergeBackgroundTaskSnapshot(
  previous: ReadonlyMap<string, SessionBackgroundTask>,
  ids: readonly string[],
  meta: readonly { id: string; taskType: string | null; description: string | null }[] | undefined,
  now: number,
): Map<string, SessionBackgroundTask> {
  const metaById = new Map((meta ?? []).map((entry) => [entry.id, entry]))
  const next = new Map<string, SessionBackgroundTask>()
  for (const id of ids) {
    const prev = previous.get(id)
    const snapshotMeta = metaById.get(id)
    next.set(id, {
      taskType: snapshotMeta?.taskType ?? prev?.taskType ?? null,
      description: snapshotMeta?.description ?? prev?.description ?? null,
      startedAt: prev?.startedAt ?? now,
      outputPath: prev?.outputPath ?? null,
    })
  }
  return next
}


export function buildBackgroundTaskWakePrompt(
  taskIds: string[],
  wakeNumber: number,
  maxWakes: number,
): string {
  const ids = taskIds.join(", ")
  return [
    "<background-task-check>",
    `Background task(s) still pending: ${ids}. Kanna woke this session to keep them alive and keep the user informed (check ${wakeNumber} of ${maxWakes} before the session is reclaimed).`,
    "Check each task's status now (use TaskOutput with block=false, or Read its output file).",
    "- If a task has finished: deliver its results to the user now.",
    "- If it is still running and making progress: post a one-line progress update for the user, then end your turn — you will be woken again when it completes or at the next check.",
    "- If it looks stuck or pointless: stop it with TaskStop and tell the user what happened and what you recommend instead.",
    "</background-task-check>",
  ].join("\n")
}

export function buildBackgroundTasksAbandonedMessage(taskIds: string[]): string {
  const ids = taskIds.join(", ")
  return [
    `Background task(s) ${ids} did not settle after repeated watchdog checks, so the idle session holding them was reclaimed and the task(s) were terminated.`,
    "Ask me to re-check whatever they were watching (e.g. the CI run) and I will pick it up in a fresh session.",
  ].join(" ")
}


export function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}


export interface UserMessageEntry {
  kind: string
  _id: string
}

export function findLastUserMessageId(messages: readonly UserMessageEntry[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i]
    if (entry.kind === "user_prompt") return entry._id
  }
  return null
}
