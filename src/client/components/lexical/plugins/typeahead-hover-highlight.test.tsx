/**
 * Regression tests for #1019 — keyboard navigation of the composer's `/` and
 * `@` pickers.
 *
 * The defect these pin: hover-to-highlight bound to `mouseenter` fights the
 * arrow keys. Each ArrowDown scrolls the menu, the browser re-hit-tests under a
 * cursor that never moved, and the hover event snaps the highlight back to the
 * row that slid beneath it. Measured in Chrome against the real composer with
 * the pointer resting on the list: twelve ArrowDown presses moved the selection
 * three rows and the list scrolled 66px instead of 384px, so the catalog past
 * the first visible page was unreachable by keyboard.
 */
import { describe, expect, it } from "bun:test"
import { act, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { renderClientMarkup } from "../../../lib/testing/renderClientMarkup"
import {
  isPointerDisplacement,
  useTypeaheadHoverHighlight,
} from "./typeahead-hover-highlight"

// ---------------------------------------------------------------------------
// isPointerDisplacement
// ---------------------------------------------------------------------------

describe("isPointerDisplacement", () => {
  it("treats the first observed position as no displacement", () => {
    // Nothing to compare against yet: a menu that opens under a resting cursor
    // must not claim the highlight from the keyboard.
    expect(isPointerDisplacement(null, { x: 10, y: 20 })).toBe(false)
  })

  it("rejects an unchanged position — the content moved, not the pointer", () => {
    expect(isPointerDisplacement({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(false)
  })

  it("accepts a change on either axis", () => {
    expect(isPointerDisplacement({ x: 10, y: 20 }, { x: 11, y: 20 })).toBe(true)
    expect(isPointerDisplacement({ x: 10, y: 20 }, { x: 10, y: 21 })).toBe(true)
    expect(isPointerDisplacement({ x: 10, y: 20 }, { x: 11, y: 21 })).toBe(true)
  })

  it("accepts a return to the origin after a move away", () => {
    // Each move re-seeds the origin, so coming back is still a displacement.
    expect(isPointerDisplacement({ x: 11, y: 21 }, { x: 10, y: 20 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useTypeaheadHoverHighlight — the same wiring both pickers use
// ---------------------------------------------------------------------------

const ROWS = ["alpha", "beta", "gamma", "delta"]

function HoverList({ initialIndex }: { initialIndex: number }) {
  const [highlighted, setHighlighted] = useState(initialIndex)
  const highlightOnPointerMove = useTypeaheadHoverHighlight()

  const handleRowMouseMove = (event: ReactMouseEvent<HTMLLIElement>, index: number) => {
    highlightOnPointerMove(event, index, setHighlighted)
  }

  return (
    <ul role="listbox">
      {ROWS.map((row, i) => (
        <li
          key={row}
          role="option"
          data-testid={row}
          aria-selected={i === highlighted}
          onMouseMove={(event) => handleRowMouseMove(event, i)}
        >
          {row}
        </li>
      ))}
    </ul>
  )
}

function selectedRow(container: HTMLElement): string | null {
  return container.querySelector('li[aria-selected="true"]')?.textContent ?? null
}

async function sendMouseMove(
  container: HTMLElement,
  testId: string,
  x: number,
  y: number,
): Promise<void> {
  const row = container.querySelector(`[data-testid="${testId}"]`)
  if (row === null) throw new Error(`no row ${testId}`)
  await act(async () => {
    row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }))
  })
}

describe("useTypeaheadHoverHighlight", () => {
  it("ignores a hover the pointer did not cause", async () => {
    // Keyboard put the highlight on "delta"; the menu then scrolls and
    // re-dispatches hover at coordinates the user never changed.
    const { container, cleanup } = await renderClientMarkup(<HoverList initialIndex={3} />)
    try {
      await sendMouseMove(container, "beta", 100, 100)
      await sendMouseMove(container, "beta", 100, 100)
      await sendMouseMove(container, "alpha", 100, 100)

      expect(selectedRow(container)).toBe("delta")
    } finally {
      await cleanup()
    }
  })

  it("highlights the row once the pointer actually moves", async () => {
    const { container, cleanup } = await renderClientMarkup(<HoverList initialIndex={0} />)
    try {
      await sendMouseMove(container, "gamma", 100, 100)
      await sendMouseMove(container, "gamma", 100, 104)

      expect(selectedRow(container)).toBe("gamma")
    } finally {
      await cleanup()
    }
  })

  it("stops following the pointer again once it comes to rest", async () => {
    const { container, cleanup } = await renderClientMarkup(<HoverList initialIndex={0} />)
    try {
      await sendMouseMove(container, "alpha", 100, 100)
      await sendMouseMove(container, "beta", 100, 108)
      expect(selectedRow(container)).toBe("beta")

      // Pointer at rest, rows scrolling under it: the highlight stays put.
      await sendMouseMove(container, "gamma", 100, 108)
      await sendMouseMove(container, "delta", 100, 108)

      expect(selectedRow(container)).toBe("beta")
    } finally {
      await cleanup()
    }
  })
})
