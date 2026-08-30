import type { HydratedTranscriptMessage } from "../../shared/transcript-types"
import type { ResolvedTranscriptRow } from "./KannaTranscript"

/**
 * Vertical rhythm for the transcript, computed per adjacent *pair* of rows.
 *
 * Every row used to carry a flat `pb-5` (20px), which is not even on Kanna's
 * 4/8/12/16/24/32 spacing scale. Worse, it gave a ~40px chrome divider exactly
 * as much air as a full assistant turn, so the transcript read as a stack of
 * equal-weight items rather than as grouped activity.
 *
 * The gap is expressed as padding *above* each row, never below. With
 * gap-below, appending row N+1 changes row N's rendered height, forcing the
 * virtualized list to re-measure an already-painted row while
 * `maintainVisibleContentPosition` is holding scroll — visible as jitter during
 * streaming, which is exactly when it is least welcome. With gap-above, an
 * appended row only sets its own padding and every measured row stays immutable.
 */
export type TranscriptGapPx = 0 | 4 | 8 | 12 | 16 | 24

/** Coarse role of a row, which is all the rhythm rules need to know. */
export type TranscriptRowTone = "user" | "assistant" | "tool" | "chrome" | "card"

/**
 * Typed over the full message union on purpose: adding a transcript kind
 * without giving it a tone is a typecheck failure, not a silent default.
 */
export const TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND: Record<
  HydratedTranscriptMessage["kind"],
  TranscriptRowTone
> = {
  user_prompt: "user",

  assistant_text: "assistant",
  assistant_thinking: "assistant",
  compact_summary: "assistant",

  tool: "tool",

  // Short divider/among-the-furniture rows.
  system_init: "chrome",
  account_info: "chrome",
  result: "chrome",
  status: "chrome",
  compact_boundary: "chrome",
  context_cleared: "chrome",
  interrupted: "chrome",
  memory_loaded: "chrome",
  context_window_updated: "chrome",

  // Full-width cards that want ordinary turn separation.
  api_error: "card",
  policy_refusal: "card",
  pending_tool_request: "card",
  auto_continue_prompt: "card",
  unknown: "card",

  // A disarm is the one thing a dead loop leaves behind, and chrome's tighter
  // gap would tuck it against the turn that killed it — exactly the "the chat
  // just went quiet" reading this row exists to prevent.
  loop_disarmed: "card",

  // Cron: cards for the substantial surfaces, chrome for one-line notices.
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

/**
 * The rhythm table. Rules are ordered by precedence — the first match wins.
 */
export function getTranscriptGapAboveForTones(
  above: TranscriptRowTone | null,
  below: TranscriptRowTone,
): TranscriptGapPx {
  // Nothing to separate from.
  if (above === null) return 0

  // A chrome divider is its own punctuation; it needs less air than a turn, and
  // this deliberately outranks the tool-run rule so a `result` still detaches
  // from the tools above it.
  if (above === "chrome" || below === "chrome") return 8

  // A run of tool activity reads as one block.
  if (above === "tool" && below === "tool") return 0

  // Tool activity belongs to the prose that introduced it.
  if (above === "assistant" && below === "tool") return 4
  if (above === "tool" && below === "assistant") return 4

  // Consecutive user messages are usually one thought split across sends.
  if (above === "user" && below === "user") return 4

  // Separate assistant blocks within a turn.
  if (above === "assistant" && below === "assistant") return 12

  return 16
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

/**
 * Static class table. Tailwind's JIT scanner cannot see a dynamic
 * `pt-[${n}px]`, so the gap must resolve to a literal class name.
 */
export const TRANSCRIPT_GAP_CLASS: Record<TranscriptGapPx, string> = {
  0: "pt-0",
  4: "pt-1",
  8: "pt-2",
  12: "pt-3",
  16: "pt-4",
  24: "pt-6",
}

/**
 * Gap class per row id, for a whole transcript.
 *
 * Returned as a lookup rather than written onto the rows themselves:
 * `computeStableResolvedTranscriptRows` reuses row objects whose contents are
 * unchanged, so a gap stored on the row would go stale whenever only a
 * *neighbour* changed.
 */
export function buildTranscriptGapClassMap(
  rows: readonly ResolvedTranscriptRow[],
): Map<string, string> {
  const gapById = new Map<string, string>()
  let previous: ResolvedTranscriptRow | null = null

  for (const row of rows) {
    gapById.set(row.id, TRANSCRIPT_GAP_CLASS[getTranscriptRowGapAbove(previous, row)])
    previous = row
  }

  return gapById
}
