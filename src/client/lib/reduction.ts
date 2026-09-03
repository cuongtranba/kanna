import type { HydratedTranscriptMessage } from "../../shared/transcript-types"

/**
 * The Reduction — a session's whole transcript compressed to one printer's device.
 *
 * Each tick is a turn and its height is that turn's duration, normalised against
 * the longest turn in the window; the live turn is doubled. It is deterministic
 * and drawn from real data, so two sessions that ran differently never look the
 * same — that is the entire point, and it is why this is not ornament.
 */

export const REDUCTION_SIZE = 26
export const REDUCTION_BASELINE_Y = 22.5

const FIRST_X = 3
const TICK_GAP = 3
const MIN_HEIGHT = 2
const MAX_HEIGHT = 19
/** Past this the ticks stop being separable at 26px, so the oldest are dropped. */
export const MAX_TICKS = 8

export interface ReductionTick {
  readonly x: number
  readonly topY: number
  /** The live turn, rendered as a doubled stroke — the same doubling the running mark uses. */
  readonly live: boolean
}

export interface ReductionGeometry {
  readonly ticks: readonly ReductionTick[]
  readonly baselineY: number
  readonly size: number
}

/**
 * `durationsMs` is oldest-first. A zero-length or all-zero window still draws:
 * a session that ran is never rendered as an empty field.
 */
export function buildReduction(
  durationsMs: readonly number[],
  options: { readonly live?: boolean } = {},
): ReductionGeometry {
  const live = options.live === true
  // The running turn owns its OWN tick. Marking the newest completed turn live
  // instead drew the finished turn as the running one, and a first-ever live
  // turn (no results yet) drew nothing at all.
  const completed = durationsMs.slice(live ? -(MAX_TICKS - 1) : -MAX_TICKS)
  const longest = completed.reduce((max, ms) => (ms > max ? ms : max), 0)

  const ticks: ReductionTick[] = completed.map((ms, index) => {
    const scale = longest > 0 ? ms / longest : 0
    const height = MIN_HEIGHT + scale * (MAX_HEIGHT - MIN_HEIGHT)
    return {
      x: FIRST_X + index * TICK_GAP,
      topY: round(REDUCTION_BASELINE_Y - height),
      live: false,
    }
  })

  if (live) {
    // Full height rather than duration-scaled: the running turn has no final
    // duration, and scaling a still-growing number would renormalise every
    // other tick on each frame — the sigil would twitch for the whole turn.
    ticks.push({
      x: FIRST_X + completed.length * TICK_GAP,
      topY: round(REDUCTION_BASELINE_Y - MAX_HEIGHT),
      live: true,
    })
  }

  return { ticks, baselineY: REDUCTION_BASELINE_Y, size: REDUCTION_SIZE }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The turn durations a chat's transcript actually recorded.
 *
 * Result entries are the only rows that carry a measured duration, so they are
 * the sigil's whole data source. Hidden results are excluded — a row the reader
 * cannot see must not put a tick in the picture of their session.
 */
export function turnDurationsFromMessages(
  messages: readonly HydratedTranscriptMessage[],
): number[] {
  // Scanned BACKWARDS and stopped at the window size. This runs on every
  // streamed chunk, and a forward scan is O(transcript) each time — which on a
  // long session is O(n^2) of work to draw eight ticks. Only the newest
  // MAX_TICKS can ever reach the sigil, so the rest are never worth reading.
  const newestFirst: number[] = []
  for (let i = messages.length - 1; i >= 0 && newestFirst.length < MAX_TICKS; i -= 1) {
    const message = messages[i]!
    if (message.kind === "result" && message.hidden !== true) {
      newestFirst.push(message.durationMs)
    }
  }
  return newestFirst.reverse()
}
