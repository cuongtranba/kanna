import type { AgentProvider, TranscriptEntry } from "../shared/types"

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
  return null
}

export function buildHistoryPrimer(
  entries: TranscriptEntry[],
  _targetProvider: AgentProvider,
  userText: string,
): string | null {
  const hasAssistant = entries.some((entry) => entry.kind === "assistant_text")
  if (!hasAssistant) return null

  const rendered = entries
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
