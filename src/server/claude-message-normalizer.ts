/**
 * claude-message-normalizer.ts
 *
 * Pure message normalisation layer: converts raw Claude SDK stream messages
 * (ClaudeRawSdkMessage) → typed TranscriptEntry[]. No IO, no side effects.
 *
 * Extracted from agent.ts — see adr (decompose-large-files chunk).
 */

import type { TranscriptEntry } from "../shared/types"
import { type AnyValue, isRecord } from "../shared/errors"
import { normalizeToolCall } from "../shared/tools"

// ---------------------------------------------------------------------------
// Utility helpers (private to this module)
// ---------------------------------------------------------------------------

function stringFromUnknown<T>(value: T): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    // JSON.stringify returns the JS value `undefined` (not a string) for
    // functions/symbols, which would drop the `result` key on persist and
    // break the `result: string` contract; coerce to "" in that case.
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

function normalizeMcpServerEntry(s: AnyValue): { name: string; status: string } {
  if (typeof s === "string") return { name: s, status: "connected" }
  if (isRecord(s) && typeof s.name === "string") {
    return { name: s.name, status: typeof s.status === "string" ? s.status : "connected" }
  }
  return { name: String(s), status: "connected" }
}

// ---------------------------------------------------------------------------
// timestamped — stamps any Omit<TranscriptEntry, "_id" | "createdAt"> with ids
// ---------------------------------------------------------------------------

export function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
) {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...entry,
  }
}

// ---------------------------------------------------------------------------
// Raw SDK message interfaces
// ---------------------------------------------------------------------------

// Minimal structural interface for raw SDK JSONL messages. All properties are
// optional so that both real SDK types and partial test fixtures are assignable.
// No `any` or `unknown` — every accessed field is typed concretely.
interface ClaudeRawContentBlock {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  name?: string
  id?: string
  // input is structurally opaque; passed straight through to normalizeToolCall
  input?: AnyValue
  tool_use_id?: string
  // content is opaque (tool_result bodies have nested structures) — passed
  // through as-is to ToolResultEntry.content which accepts any value.
  content?: object | string | null
  is_error?: boolean
}
interface ClaudeRawMessageBody {
  id?: string
  content?: ClaudeRawContentBlock[] | string
  role?: string
  model?: string
  stop_reason?: string | null
  usage?: AnyValue
}
export interface ClaudeRawSdkMessage {
  type?: string
  subtype?: string
  uuid?: string
  model?: string
  tools?: string[]
  agents?: string[]
  slash_commands?: string[]
  mcp_servers?: AnyValue[]
  message?: ClaudeRawMessageBody
  isApiErrorMessage?: boolean
  apiErrorStatus?: number
  request_id?: string
  requestId?: string
  is_error?: boolean
  duration_ms?: number
  result?: string
  total_cost_usd?: number
  status?: string | null
  summary?: string
  skip_transcript?: boolean
  // SDK background_tasks_changed payload (level signal; ids + type only)
  tasks?: { task_id?: string; task_type?: string; description?: string }[]
  durationMs?: number
  pendingWorkflowCount?: number
  usage?: AnyValue
  modelUsage?: AnyValue
  // SDK rate-limit event fields
  rate_limit_info?: Record<string, string | number | boolean | null>
  session_id?: string
  stop_reason?: string | null
  // Task-notification fields
  task_id?: string
  output_file?: string
  tool_use_id?: string
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function getClaudeAssistantMessageUsageId(message: ClaudeRawSdkMessage): string | null {
  if (typeof message?.message?.id === "string" && message.message.id) {
    return message.message.id
  }
  if (typeof message?.uuid === "string" && message.uuid) {
    return message.uuid
  }
  return null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Benign turn-end markers the Claude CLI emits as model "<synthetic>" messages
// (the CVH-family constants in the CLI binary) when a turn ends with nothing to
// say. They carry isApiErrorMessage:false and carry zero information, so they
// are dropped entirely — never rendered as a red api_error card and never as an
// assistant_text bubble. In PTY channel-delivered turns the CLI emits one at the
// start of every turn; surfacing it as assistant_text flipped the UI out of its
// waiting state before the real reply streamed (spinner vanished, placeholder
// read as the answer). See adr-20260607-drop-synthetic-no-response-marker.
const SYNTHETIC_NON_ERROR_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "No response requested.",
  "No action needed.",
  "Nothing needed from you.",
])

// Claude CLI hard-refusals (Usage-Policy / real-time cyber-safeguard block)
// arrive as a model "<synthetic>" message with stop_reason "refusal" and one of
// these phrases in the text. Used to split a deliberate refusal out of the
// generic api_error bucket. See adr-20260607-surface-policy-refusal-entry.
const POLICY_REFUSAL_TEXT_MARKERS: readonly string[] = [
  "violate our Usage Policy",
  "unable to respond to this request",
]

// ---------------------------------------------------------------------------
// Private normalisation helpers
// ---------------------------------------------------------------------------

export function normalizeToolContent(c: AnyValue): string | Record<string, unknown> | readonly unknown[] | null {
  if (c === null || c === undefined) return null
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c
  if (isRecord(c)) return c
  return null
}

// Type-bridge: ClaudeRawSdkMessage is a structural duck-type — all fields optional.
// Any SDK message object satisfies it at runtime via dynamic field access.
function isSdkToClaudeMessage(m: object): m is ClaudeRawSdkMessage {
  void m
  return true
}

export { isSdkToClaudeMessage }

// ---------------------------------------------------------------------------
// Main normalisation function
// ---------------------------------------------------------------------------

export function normalizeClaudeStreamMessage(message: ClaudeRawSdkMessage): TranscriptEntry[] {
  const debugRaw = JSON.stringify(message)
  const messageId = typeof message.uuid === "string" ? message.uuid : undefined

  if (message.type === "system" && message.subtype === "init") {
    return [
      timestamped({
        kind: "system_init",
        messageId,
        provider: "claude",
        model: typeof message.model === "string" ? message.model : "unknown",
        tools: Array.isArray(message.tools) ? message.tools : [],
        agents: Array.isArray(message.agents) ? message.agents : [],
        slashCommands: Array.isArray(message.slash_commands)
          ? message.slash_commands.filter((entry: string) => !entry.startsWith("._"))
          : [],
        mcpServers: Array.isArray(message.mcp_servers)
          ? message.mcp_servers.map((s: AnyValue) => normalizeMcpServerEntry(s))
          : [],
        debugRaw,
      }),
    ]
  }

  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    const joinedText = message.message.content
      .filter((c): c is ClaudeRawContentBlock & { text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("")
    // The Claude CLI reuses model "<synthetic>" for two distinct purposes:
    // genuine API errors AND benign turn-end placeholders ("No response
    // requested." etc., the CVH-family constants in the CLI binary). The benign
    // markers carry isApiErrorMessage:false, so a bare synthetic model is NOT
    // sufficient to classify as an error — only treat it as api_error when the
    // flag is set, or the synthetic text is not a known benign placeholder.
    const isSyntheticModel = message.message?.model === "<synthetic>"
    const isBenignSyntheticPlaceholder = isSyntheticModel
      && SYNTHETIC_NON_ERROR_PLACEHOLDERS.has(joinedText.trim())
    if (
      message.isApiErrorMessage === true
      || (isSyntheticModel && !isBenignSyntheticPlaceholder)
    ) {
      const statusFromField = typeof message.apiErrorStatus === "number" ? message.apiErrorStatus : undefined
      const statusFromText = (() => {
        const match = /API Error:\s*(\d{3})/i.exec(joinedText)
        return match ? Number.parseInt(match[1], 10) : undefined
      })()
      let requestId: string | undefined
      if (typeof message.request_id === "string") {
        requestId = message.request_id
      } else if (typeof message.requestId === "string") {
        requestId = message.requestId
      } else {
        requestId = undefined
      }
      // A deliberate model refusal (Usage-Policy / cyber-safeguard block) is NOT
      // a transport error — it carries stop_reason "refusal" and/or the policy
      // phrase. Surface it as its own `policy_refusal` kind so the UI labels it
      // "Blocked — Usage Policy" instead of a generic red API-error card that
      // reads like a network failure. See adr-20260607-surface-policy-refusal-entry.
      const isPolicyRefusal =
        message.message?.stop_reason === "refusal"
        || POLICY_REFUSAL_TEXT_MARKERS.some((marker) => joinedText.includes(marker))
      if (isPolicyRefusal) {
        return [timestamped({
          kind: "policy_refusal",
          messageId,
          text: joinedText,
          requestId,
          debugRaw,
        })]
      }
      return [timestamped({
        kind: "api_error",
        messageId,
        status: statusFromField ?? statusFromText ?? 0,
        text: joinedText,
        requestId,
        debugRaw,
      })]
    }
    // Benign synthetic turn-end marker (not an api_error): drop it. The api_error
    // branch above already claimed any isApiErrorMessage:true message, so a real
    // error carrying the same text still surfaces. Turn termination is driven by
    // the separate system/turn_duration → result message, not this placeholder.
    if (isBenignSyntheticPlaceholder) {
      return []
    }
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      // Extended-reasoning block. Surface as its own kind so the UI renders it
      // collapsed and the event log keeps reasoning distinct from output. A
      // redacted block carries only a signature (empty thinking) — skip it.
      if (content.type === "thinking" && typeof content.thinking === "string" && content.thinking.length > 0) {
        entries.push(timestamped({
          kind: "assistant_thinking",
          messageId,
          text: content.thinking,
          signature: typeof content.signature === "string" ? content.signature : undefined,
          debugRaw,
        }))
      }
      if (content.type === "text" && typeof content.text === "string") {
        entries.push(timestamped({
          kind: "assistant_text",
          messageId,
          text: content.text,
          debugRaw,
        }))
      }
      if (content.type === "tool_use" && typeof content.name === "string" && typeof content.id === "string") {
        entries.push(timestamped({
          kind: "tool_call",
          messageId,
          tool: normalizeToolCall({
            toolName: content.name,
            toolId: content.id,
            input: isRecord(content.input) ? content.input : {},
          }),
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "user" && Array.isArray(message.message?.content)) {
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "tool_result" && typeof content.tool_use_id === "string") {
        entries.push(timestamped({
          kind: "tool_result",
          messageId,
          toolId: content.tool_use_id,
          content: normalizeToolContent(content.content),
          isError: Boolean(content.is_error),
          debugRaw,
        }))
      }
      if (message.message.role === "user" && typeof message.message.content === "string") {
        entries.push(timestamped({
          kind: "compact_summary",
          messageId,
          summary: message.message.content,
          debugRaw,
        }))
      }
    }
    return entries
  }

  // No `result.subtype === "compaction"` branch by design: Kanna never relies
  // on the SDK's in-loop auto-compact. The SDK `query()` driver spawns a fresh
  // subprocess per turn and never enters claude-code's REPL loop, so that
  // compaction stop is unreachable here (see proactive-compact.ts). Context
  // compaction is instead driven by Kanna injecting a native `/compact` turn
  // and surfaces purely as the `system/compact_boundary` message handled
  // below — not as a result subtype.
  if (message.type === "result") {
    if (message.subtype === "cancelled") {
      return [timestamped({ kind: "interrupted", messageId, debugRaw })]
    }
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: message.is_error ? "error" : "success",
        isError: Boolean(message.is_error),
        durationMs: typeof message.duration_ms === "number" ? message.duration_ms : 0,
        result: typeof message.result === "string" ? message.result : stringFromUnknown(message.result),
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "status" && typeof message.status === "string") {
    return [timestamped({ kind: "status", messageId, status: message.status, debugRaw })]
  }

  // The Agent SDK emits SDKTaskNotificationMessage when a
  // `Bash(run_in_background)` task settles (status completed|failed|stopped).
  // The model is re-driven natively by the SDK's user-origin task-notification
  // message (the `canUseTool`-after-result self-resume noted in send()), so
  // this branch only SURFACES the completion into the transcript/event log —
  // without it the background work was invisible to Kanna. `skip_transcript`
  // marks ambient/housekeeping tasks the SDK asks consumers to hide inline.
  if (message.type === "system" && message.subtype === "task_notification") {
    const taskStatus = typeof message.status === "string" ? message.status : "completed"
    const summary = typeof message.summary === "string" && message.summary.length > 0
      ? message.summary
      : "(no summary)"
    const taskId = typeof message.task_id === "string" ? message.task_id : undefined
    return [timestamped({
      kind: "status",
      messageId,
      status: `Background task ${taskStatus}: ${summary}`,
      hidden: message.skip_transcript === true ? true : undefined,
      backgroundTaskId: taskId,
      debugRaw,
    })]
  }

  // SDKBackgroundTasksChangedMessage: the full set of live background tasks
  // after a membership change (launch, completion, kill, backgrounding). A
  // LEVEL signal with REPLACE semantics — per the SDK docs, consumers that
  // need "is background work running" should swap their set for each payload
  // instead of pairing task_started/task_notification edges, so a missed
  // bookend can never wedge a stale indicator. This feeds the session
  // keep-alive guard: without it the idle reaper killed sessions mid-flight
  // background Agent runs (the launch tool_result regex only knew Bash).
  // `in_process_teammate` is excluded — teammates are long-lived by design
  // (running for their whole lifetime; see claude-code gh-30008), so arming
  // on them would pin the session until the deadline backstop.
  if (message.type === "system" && message.subtype === "background_tasks_changed") {
    const tasks = Array.isArray(message.tasks) ? message.tasks : []
    const ids: string[] = []
    for (const task of tasks) {
      if (typeof task.task_id !== "string" || task.task_id.length === 0) continue
      if (task.task_type === "in_process_teammate") continue
      ids.push(task.task_id)
    }
    return [timestamped({
      kind: "status",
      messageId,
      status: `Background tasks: ${ids.length} running`,
      hidden: true,
      backgroundTaskIdsSnapshot: ids,
      debugRaw,
    })]
  }

  // Interactive TUI claude never writes a `type: "result"` row — it writes
  // `system/turn_duration` instead (per canon/shannon research). Synthesize a
  // turn-end `result` so the agent loop and UI see the turn complete.
  if (message.type === "system" && message.subtype === "turn_duration") {
    let durationMs: number
    if (typeof message.durationMs === "number") {
      durationMs = message.durationMs
    } else if (typeof message.duration_ms === "number") {
      durationMs = message.duration_ms
    } else {
      durationMs = 0
    }
    const pendingWorkflowCount = typeof message.pendingWorkflowCount === "number"
      ? message.pendingWorkflowCount
      : undefined
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: "success",
        isError: false,
        durationMs,
        result: "",
        costUsd: undefined,
        ...(pendingWorkflowCount !== undefined ? { pendingWorkflowCount } : {}),
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "compact_boundary") {
    return [timestamped({ kind: "compact_boundary", messageId, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "context_cleared") {
    return [timestamped({ kind: "context_cleared", messageId, debugRaw })]
  }

  if (
    message.type === "user" &&
    message.message?.role === "user" &&
    typeof message.message.content === "string" &&
    message.message.content.startsWith("This session is being continued")
  ) {
    return [timestamped({ kind: "compact_summary", messageId, summary: message.message.content, debugRaw })]
  }

  return []
}
