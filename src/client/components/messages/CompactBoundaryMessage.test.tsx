import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CompactBoundaryMessage, ContextClearedMessage } from "./CompactBoundaryMessage"

function patternIds(html: string): string[] {
  return [...html.matchAll(/<pattern id="([^"]+)"/g)].map((match) => match[1] ?? "")
}

describe("transcript boundary rules", () => {
  test("names the boundary", () => {
    expect(renderToStaticMarkup(<ContextClearedMessage />)).toContain("Context Cleared")
    expect(renderToStaticMarkup(<CompactBoundaryMessage />)).toContain("Compacted")
  })

  test("draws the rule at a full device pixel, not a sub-pixel hairline", () => {
    // The rule was in the DOM the whole time and invisible: a 0.5 stroke inside
    // a viewBox squashed by preserveAspectRatio="none" landed under one device
    // pixel. DESIGN.md sizes a divider at 1px, so that is what it strokes.
    const html = renderToStaticMarkup(<ContextClearedMessage />)
    expect(html).toContain('stroke-width="1"')
    expect(html).not.toContain('stroke-width="0.5"')
    expect(html).not.toContain('preserveAspectRatio="none"')
  })

  test("inks the rule in the divider token, not a faded body colour", () => {
    const html = renderToStaticMarkup(<ContextClearedMessage />)
    expect(html).toContain("text-border")
    expect(html).not.toContain("text-muted-foreground/30")
  })

  test("gives every rule its own pattern id", () => {
    // Two rules render per boundary and a transcript holds many boundaries.
    // A shared id makes every rect resolve to whichever pattern happens to be
    // first in the document, so one unmount can restyle the rest.
    const ids = patternIds(
      renderToStaticMarkup(
        <>
          <ContextClearedMessage />
          <CompactBoundaryMessage />
        </>,
      ),
    )
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })

  test("hides the decorative rule from screen readers", () => {
    // The label carries the meaning; the rule is ornament either side of it.
    const html = renderToStaticMarkup(<ContextClearedMessage />)
    expect(html.match(/aria-hidden="true"/g) ?? []).toHaveLength(2)
  })

  test("uses token colours, never a literal one", () => {
    expect(renderToStaticMarkup(<ContextClearedMessage />)).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
