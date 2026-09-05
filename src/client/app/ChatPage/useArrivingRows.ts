import { useEffect, useMemo, useRef } from "react"
import { STAGGER_LIMIT } from "../../lib/motion"

export interface ArrivingRows {
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

  return useMemo<ArrivingRows>(() => ({
    indexOf: (rowId: string) => arrivingRef.current.get(rowId),
  }), [])
}
