/**
 * Pure prompt-manipulation helpers — no IO, no side effects.
 * Extracted from agent.ts to keep it lean.
 */

import type { ChatAttachment, NormalizedToolCall } from "../shared/types"
import type { SessionBackgroundTask } from "./claude-session-state"
import { isRecord } from "../shared/errors"

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

// ---------------------------------------------------------------------------
// Attachment hint
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Steered message
// ---------------------------------------------------------------------------

const STEERED_MESSAGE_PREFIX = `<system-message>
The user would like to inform you of something while you continue to work. Acknowledge receipt immediately with a text response, then continue with the task at hand, incorporating the user's feedback if needed.
</system-message>`

export function buildSteeredMessageContent(content: string) {
  return content.trim().length > 0
    ? `${STEERED_MESSAGE_PREFIX}\n\n${content}`
    : STEERED_MESSAGE_PREFIX
}

// ---------------------------------------------------------------------------
// Error-message classifiers
// ---------------------------------------------------------------------------

export function isPromptTooLongMessage(message: string): boolean {
  return /\bprompt\b.*\btoo\s+long\b/i.test(message)
    || /\bprompt\b.*\btoo\s+large\b/i.test(message)
}

// The stored session token points at a conversation the Claude CLI never
// persisted (e.g. a spawn interrupted before its first write). Every resume
// then fails instantly — and the doomed spawn mints yet another unpersisted
// session id, so without clearing the token the chat is wedged forever. The
// message rides in result.errors (debugRaw); result text is empty.
export function isNoConversationFoundMessage(message: string): boolean {
  return /No conversation found with session ID/i.test(message)
}

// ---------------------------------------------------------------------------
// SDK effort normaliser
// ---------------------------------------------------------------------------

/** Narrows a free-form effort string to the SDK-accepted union without a cast. */
export function toSdkEffort(effort: string | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max") {
    return effort
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Background-task ID extraction
// ---------------------------------------------------------------------------

// Claude Code's BashTool emits this exact line in the tool_result when a command
// is launched with `run_in_background: true`. It is the only observable launch
// signal in Kanna's entry stream (the later `<task-notification>` line produces
// no transcript entry). The id is alphanumeric. Global flag: one result may
// report multiple launches in theory; capture every id.
const BACKGROUND_TASK_LAUNCH_RE = /Command running in background with ID:\s*(\w+)/g

// Claude Code's AgentTool background launch (`Agent(run_in_background: true)`)
// emits "Async agent launched successfully." followed by an `agentId:` line
// (AgentTool async_launched result). The marker gate prevents arming on
// incidental "agentId:" text in unrelated tool output. On the SDK driver the
// `background_tasks_changed` level signal is the primary arm source; this
// regex is the only launch signal on the PTY driver (transcript JSONL carries
// no system events on CLI ≥ 2.1.x) and a version-skew fallback on SDK.
const ASYNC_AGENT_LAUNCH_MARKER = "Async agent launched successfully"
const ASYNC_AGENT_ID_RE = /agentId:\s*(\w+)/g

/** Extract background-task ids from a tool_result entry's content (string or content blocks). */
export function backgroundTaskIdsFromToolResult<T>(content: T): string[] {
  let text = ""
  if (typeof content === "string") {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block)) {
        const blockText = block.text
        if (typeof blockText === "string") {
          text += `${blockText}\n`
        }
      }
    }
  } else {
    return []
  }
  const ids: string[] = []
  for (const match of text.matchAll(BACKGROUND_TASK_LAUNCH_RE)) {
    if (match[1]) ids.push(match[1])
  }
  if (text.includes(ASYNC_AGENT_LAUNCH_MARKER)) {
    for (const match of text.matchAll(ASYNC_AGENT_ID_RE)) {
      if (match[1] && !ids.includes(match[1])) ids.push(match[1])
    }
  }
  return ids
}

/**
 * Human description for a tool call, used to label a background task whose
 * launch was seen only through the tool_result regex (PTY driver; SDK version
 * skew). Bash carries `description` (else the command itself); other tools
 * (Agent/Task) expose `description` on the raw input.
 */
export function toolCallDescription(tool: NormalizedToolCall): string | null {
  if (tool.toolKind === "bash") {
    const description = tool.input.description ?? tool.input.command
    return typeof description === "string" && description.length > 0 ? description : null
  }
  const raw = tool.rawInput?.description
  return typeof raw === "string" && raw.length > 0 ? raw : null
}

/**
 * REPLACE-semantics fold of a `background_tasks_changed` snapshot over the
 * session's live task map. Ids absent from the snapshot drop out; surviving
 * ids keep their first-seen `startedAt` and any previously learned metadata
 * (the snapshot wins when it carries a value). Pure — `now` injected.
 */
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
    })
  }
  return next
}

// ---------------------------------------------------------------------------
// Background-task watchdog wake prompts
// (adr-20260801-background-task-wake-escalation)
// ---------------------------------------------------------------------------

/**
 * Agent-directed watchdog prompt sent when a background task's keep-alive
 * window lapses while the task is still pending. The agent must resolve the
 * situation VISIBLY: report results if the task finished, post a progress
 * update if it is still running, or stop a stuck task and say so.
 */
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

/**
 * Visible chat notice for the terminal escalation step: the wake budget ran
 * out and the session (with its still-pending background task children) was
 * closed. Rendered as an error result entry in the chat.
 */
export function buildBackgroundTasksAbandonedMessage(taskIds: string[]): string {
  const ids = taskIds.join(", ")
  return [
    `Background task(s) ${ids} did not settle after repeated watchdog checks, so the idle session holding them was reclaimed and the task(s) were terminated.`,
    "Ask me to re-check whatever they were watching (e.g. the CI run) and I will pick it up in a fresh session.",
  ].join(" ")
}

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

export function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
