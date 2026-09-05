import { describe, expect, it } from "bun:test"
import { act, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { renderClientMarkup } from "../../../lib/testing/renderClientMarkup"
import {
  isPointerDisplacement,
  useTypeaheadHoverHighlight,
} from "./typeahead-hover-highlight"


describe("isPointerDisplacement", () => {
  it("treats the first observed position as no displacement", () => {
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
    expect(isPointerDisplacement({ x: 11, y: 21 }, { x: 10, y: 20 })).toBe(true)
  })
})


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

      await sendMouseMove(container, "gamma", 100, 108)
      await sendMouseMove(container, "delta", 100, 108)

      expect(selectedRow(container)).toBe("beta")
    } finally {
      await cleanup()
    }
  })
})
