import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SessionMark } from "./session-mark"
import type { SessionMarkKind } from "../../lib/chatStatusIndicator"

const KINDS: readonly SessionMarkKind[] = ["filled", "half", "ring", "dashed"]

const render = (kind: SessionMarkKind) => renderToStaticMarkup(<SessionMark kind={kind} />)

describe("SessionMark", () => {
  test("draws every kind as SVG, never as a text glyph", () => {
    for (const kind of KINDS) {
      const html = render(kind)
      expect(html).toContain("<svg")
      expect(html).not.toMatch(/[●◐○◌]/)
    }
  })

  test("no two kinds share a silhouette", () => {
    const shapes = KINDS.map(render)
    expect(new Set(shapes).size).toBe(KINDS.length)
  })

  test("warmth reads as fill, so it cannot be mistaken for a run-state stroke", () => {
    expect(render("filled")).toContain('fill="currentColor"')
    expect(render("ring")).toContain('fill="none"')
    expect(render("dashed")).toContain("stroke-dasharray")
  })

  test("inherits colour rather than hard-coding it", () => {
    for (const kind of KINDS) {
      expect(render(kind)).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })

  test("is decoration for the eye — the badge supplies the accessible name", () => {
    expect(render("filled")).toContain('aria-hidden="true"')
  })
})
