import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { isRecord, type AnyValue } from "../shared/errors"

// Policy: renderEntry handles message-shaped TranscriptEntry kinds only
// (user_prompt, assistant_text, tool_call). All other kinds — slash-command
// echoes, errors, autocontinue markers, status, etc. — are intentionally
// omitted. The primer is a context bridge, not a full transcript replay.
// TODO: PRIMER_MAX_CHARS is provider-blind; per-provider tuning + telemetry
// are phase-1 follow-ups.
export const PRIMER_MAX_CHARS = 60_000

export function shouldInjectPrimer(
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>,
  targetProvider: AgentProvider,
  userClearedContext: boolean,
): boolean {
  if (userClearedContext) return true
  return sessionTokensByProvider[targetProvider] == null
}

interface RenderedEntry {
  text: string
  createdAt: number
}

function renderEntry(entry: TranscriptEntry): RenderedEntry | null {
  const ts = new Date(entry.createdAt).toISOString().replace("T", " ").slice(0, 19)
  if (entry.kind === "user_prompt") {
    return { text: `[user, ${ts}]\n${entry.content}\n`, createdAt: entry.createdAt }
  }
  if (entry.kind === "assistant_text") {
    return { text: `[assistant, ${ts}]\n${entry.text}\n`, createdAt: entry.createdAt }
  }
  if (entry.kind === "tool_call") {
    return { text: `[tool, ${ts}] ${entry.tool.toolName}\n`, createdAt: entry.createdAt }
  }
  if (entry.kind === "compact_summary") {
    return {
      text: `[summary of earlier conversation, ${ts}]\n${entry.summary}\n`,
      createdAt: entry.createdAt,
    }
  }
  return null
}

/**
 * The slice of a chat that still counts as context.
 *
 * Everything before the most recent `context_cleared` / `compact_boundary` was
 * deliberately dropped — by the user, by a loop iteration, or by the provider's
 * own compaction. Replaying it here would silently undo that, and the primer is
 * injected precisely when the session token is null, which is exactly the state
 * a clear leaves behind.
 *
 * A `compact_summary` IS the carried context, so it is hoisted across its own
 * boundary when it sits on the older side — the SDK and the CLI are free to
 * emit the two in either order.
 */
function selectPrimerEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  let resetIndex = -1
  let lastClearedIndex = -1
  for (let i = 0; i < entries.length; i += 1) {
    const kind = entries[i].kind
    if (kind === "context_cleared") {
      resetIndex = i
      lastClearedIndex = i
    } else if (kind === "compact_boundary") {
      resetIndex = i
    }
  }
  if (resetIndex < 0) return [...entries]

  const selected = entries.slice(resetIndex + 1)
  if (selected.some((entry) => entry.kind === "compact_summary")) return selected

  for (let i = resetIndex; i > lastClearedIndex; i -= 1) {
    if (entries[i].kind === "compact_summary") return [entries[i], ...selected]
  }
  return selected
}

export function buildHistoryPrimer(
  entries: readonly TranscriptEntry[],
  _targetProvider: AgentProvider,
  userText: string,
): string | null {
  const inContext = selectPrimerEntries(entries)
  const hasAssistant = inContext.some(
    (entry) => entry.kind === "assistant_text" || entry.kind === "compact_summary",
  )
  if (!hasAssistant) return null

  const rendered = inContext
    .map(renderEntry)
    .filter((entry): entry is RenderedEntry => entry !== null)

  const header = "The following is the prior conversation in this chat. The first part is context only; the actual request follows after the marker line.\n\n--- BEGIN PRIOR CONVERSATION ---\n"
  const footer = "--- END PRIOR CONVERSATION ---\n\n"
  const overhead = header.length + footer.length + userText.length
  const budget = Math.max(0, PRIMER_MAX_CHARS - overhead)

  const selected: RenderedEntry[] = []
  let used = 0
  let truncated = false
  for (let i = rendered.length - 1; i >= 0; i -= 1) {
    const candidate = rendered[i]
    if (used + candidate.text.length > budget) {
      truncated = i > 0 || selected.length === 0 ? true : truncated
      break
    }
    selected.unshift(candidate)
    used += candidate.text.length
  }

  const truncMarker = truncated ? "[... earlier conversation omitted ...]\n" : ""
  return `${header}${truncMarker}${selected.map((entry) => entry.text).join("")}${footer}${userText}`
}

export function extractPreviousAssistantReply(entries: readonly TranscriptEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === "assistant_text") return entry.text
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind !== "tool_call") continue
    const tool = entry.tool
    const inputRaw: Record<string, AnyValue> | null = isRecord(tool.input) ? <Record<string, AnyValue>>tool.input : null
    const cmd = inputRaw && typeof inputRaw.command === "string" ? inputRaw.command : ""
    const suffix = cmd ? `: ${cmd}` : ""
    return `${tool.toolName}${suffix}`.trim()
  }
  return null
}
