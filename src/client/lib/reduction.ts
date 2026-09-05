import type { HydratedTranscriptMessage } from "../../shared/transcript-types"


export const REDUCTION_SIZE = 26
export const REDUCTION_BASELINE_Y = 22.5

const FIRST_X = 3
const TICK_GAP = 3
const MIN_HEIGHT = 2
const MAX_HEIGHT = 19
export const MAX_TICKS = 8

export interface ReductionTick {
  readonly x: number
  readonly topY: number
  readonly live: boolean
}

export interface ReductionGeometry {
  readonly ticks: readonly ReductionTick[]
  readonly baselineY: number
  readonly size: number
}

export function buildReduction(
  durationsMs: readonly number[],
  options: { readonly live?: boolean } = {},
): ReductionGeometry {
  const live = options.live === true
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

export function turnDurationsFromMessages(
  messages: readonly HydratedTranscriptMessage[],
): number[] {
  const newestFirst: number[] = []
  for (let i = messages.length - 1; i >= 0 && newestFirst.length < MAX_TICKS; i -= 1) {
    const message = messages[i]!
    if (message.kind === "result" && message.hidden !== true) {
      newestFirst.push(message.durationMs)
    }
  }
  return newestFirst.reverse()
}
