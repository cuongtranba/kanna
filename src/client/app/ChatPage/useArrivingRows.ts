import { useEffect, useMemo, useRef } from "react"
import { STAGGER_LIMIT } from "../../lib/motion"

/**
 * Which transcript rows are arriving right now, and in what order.
 *
 * The transcript is a virtualized `LegendList`: rows mount and unmount as the
 * viewport moves, so "this row just mounted" is not "this row is new". Keying
 * the animation off mount would replay the whole sequence every time a row
 * scrolled back into view, and keying it off list LENGTH alone would animate
 * the entire backlog the first time a chat opened. Identity is the only signal
 * that means what it looks like.
 *
 * Three properties are load-bearing rather than defensive:
 *
 * **The map is REPLACED on every append, never accumulated.** It holds one
 * burst of ids, not the transcript's history. Transcripts here reach 36k rows,
 * so remembering every row ever seen would be a leak proportional to session
 * length.
 *
 * **Only the appended TAIL is read.** `rows.slice(previousCount)` touches the
 * new rows only; mapping the whole array would put an O(n) walk on every
 * streamed chunk, which is the hot path this feature must not appear in.
 *
 * **The first population for a chat is DISCARDED.** Opening a chat makes every
 * existing row "new" by any count-based measure, and animating a whole backlog
 * on arrival is both wrong to look at and the exact shape handoff pitfall #1
 * warns about.
 */
export interface ArrivingRows {
  /**
   * Stagger position for a row that is arriving, or `undefined` for one that
   * was already there. Already capped at `STAGGER_LIMIT`, so a 200-row burst
   * never queues a wave.
   */
  indexOf(rowId: string): number | undefined
}

interface IdentifiedRow {
  readonly id: string
}

export function useArrivingRows(
  rows: readonly IdentifiedRow[],
  resetKey: string | null,
): ArrivingRows {
  const arrivingRef = useRef<Map<string, number>>(new Map())
  const previousCountRef = useRef(0)
  const seededChatRef = useRef<string | null>(null)

  useEffect(() => {
    // A chat switch restarts the count. Without this the new chat's rows read
    // as an append onto the old chat's length, and animate (or do not) at
    // random depending on which chat was longer.
    if (seededChatRef.current !== resetKey) {
      seededChatRef.current = resetKey
      previousCountRef.current = rows.length
      arrivingRef.current = new Map()
      return
    }

    const previousCount = previousCountRef.current
    previousCountRef.current = rows.length

    if (rows.length <= previousCount) {
      arrivingRef.current = new Map()
      return
    }

    const next = new Map<string, number>()
    for (const [index, row] of rows.slice(previousCount).entries()) {
      next.set(row.id, Math.min(index, STAGGER_LIMIT - 1))
    }
    arrivingRef.current = next
  }, [rows, resetKey])

  /*
    Stable for the component's whole life. `renderItem` is a `useCallback` that
    has to list this in its deps, and a fresh object every render would make
    `renderItem` fresh every render — which re-renders every visible row of the
    list on every streamed chunk. It closes over refs only, so `[]` is honest.

    Reading a ref inside the closure is a read, not a mutation: `renderItem`
    stays pure, which the react-hooks purity rule requires.
  */
  return useMemo<ArrivingRows>(() => ({
    indexOf: (rowId: string) => arrivingRef.current.get(rowId),
  }), [])
}
