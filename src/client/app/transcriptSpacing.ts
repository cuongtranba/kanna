import type { HydratedTranscriptMessage } from "../../shared/transcript-types"
import type { ResolvedTranscriptRow } from "./KannaTranscript"

export type TranscriptGapPx = 0 | 4 | 8 | 12 | 16 | 24 | 32

export type TranscriptRowTone = "user" | "assistant" | "tool" | "chrome" | "card"

export const TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND: Record<
  HydratedTranscriptMessage["kind"],
  TranscriptRowTone
> = {
  user_prompt: "user",

  assistant_text: "assistant",
  assistant_thinking: "assistant",
  compact_summary: "assistant",

  tool: "tool",

  system_init: "chrome",
  account_info: "chrome",
  result: "chrome",
  status: "chrome",
  compact_boundary: "chrome",
  context_cleared: "chrome",
  interrupted: "chrome",
  memory_loaded: "chrome",
  context_window_updated: "chrome",

  api_error: "card",
  policy_refusal: "card",
  pending_tool_request: "card",
  auto_continue_prompt: "card",
  unknown: "card",

  loop_disarmed: "card",

  cron_armed: "card",
  cron_command_error: "card",
  cron_run: "card",
  cron_list: "card",
  cron_run_skipped: "chrome",
  cron_job_change: "chrome",
}

export function transcriptRowTone(row: ResolvedTranscriptRow): TranscriptRowTone {
  if (row.kind === "tool-group") return "tool"
  return TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND[row.message.kind] ?? "card"
}

export function getTranscriptGapAboveForTones(
  above: TranscriptRowTone | null,
  below: TranscriptRowTone,
): TranscriptGapPx {
  if (above === null) return 0

  if (above === "chrome" || below === "chrome") return 8

  if (above === "tool" && below === "tool") return 0

  if (above === "assistant" && below === "tool") return 4
  if (above === "tool" && below === "assistant") return 4

  if (above === "user" && below === "user") return 4

  if (above === "assistant" && below === "assistant") return 12

  return 32
}

export function transcriptGapHasRule(gap: TranscriptGapPx): boolean {
  return gap === 32
}

export function getTranscriptRowGapAbove(
  above: ResolvedTranscriptRow | null,
  below: ResolvedTranscriptRow,
): TranscriptGapPx {
  return getTranscriptGapAboveForTones(
    above ? transcriptRowTone(above) : null,
    transcriptRowTone(below),
  )
}

export const TRANSCRIPT_GAP_CLASS: Record<TranscriptGapPx, string> = {
  0: "pt-0",
  4: "pt-1",
  8: "pt-2",
  12: "pt-3",
  16: "pt-4",
  24: "pt-6",
  32: "pt-8",
}

export const TRANSCRIPT_RULE_CLASS =
  "relative before:absolute before:inset-x-0 before:top-4 before:h-px before:bg-border before:content-['']"

export function buildTranscriptGapClassMap(
  rows: readonly ResolvedTranscriptRow[],
): Map<string, string> {
  const gapById = new Map<string, string>()
  let previous: ResolvedTranscriptRow | null = null

  for (const row of rows) {
    const gap = getTranscriptRowGapAbove(previous, row)
    const gapClass = TRANSCRIPT_GAP_CLASS[gap]
    gapById.set(row.id, transcriptGapHasRule(gap) ? `${gapClass} ${TRANSCRIPT_RULE_CLASS}` : gapClass)
    previous = row
  }

  return gapById
}
