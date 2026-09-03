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
const MAX_TICKS = 8

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
  const recent = durationsMs.slice(-MAX_TICKS)
  const longest = recent.reduce((max, ms) => (ms > max ? ms : max), 0)

  const ticks = recent.map((ms, index) => {
    const scale = longest > 0 ? ms / longest : 0
    const height = MIN_HEIGHT + scale * (MAX_HEIGHT - MIN_HEIGHT)
    return {
      x: FIRST_X + index * TICK_GAP,
      topY: round(REDUCTION_BASELINE_Y - height),
      live: options.live === true && index === recent.length - 1,
    }
  })

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
  const durations: number[] = []
  for (const message of messages) {
    if (message.kind === "result" && message.hidden !== true) {
      durations.push(message.durationMs)
    }
  }
  return durations
}
