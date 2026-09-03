import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Plate, PlateCaption, SectionCaption, formatPlateIndex } from "./plate"

describe("Plate", () => {
  test("carries no box, radius, or shadow — only a rule and space", () => {
    const html = renderToStaticMarkup(<Plate>body</Plate>)
    expect(html).toContain("border-t")
    expect(html).not.toMatch(/rounded/)
    expect(html).not.toMatch(/shadow/)
  })

  test("the rule and the air sit ABOVE, never below", () => {
    // A bottom margin changes the height of an already-painted row, which in a
    // streaming list forces a re-measure while scroll is held. transcriptSpacing
    // documents the jitter that caused; this primitive must not reintroduce it.
    const html = renderToStaticMarkup(<Plate>body</Plate>)
    expect(html).not.toMatch(/\bborder-b\b/)
    expect(html).not.toMatch(/\bmb-/)
    expect(html).not.toMatch(/\bpb-/)
  })
})

describe("PlateCaption", () => {
  test("states the plate, the kind, and a fact", () => {
    const html = renderToStaticMarkup(<PlateCaption index={4} kind="Diff" fact="+4 −7" />)
    expect(html).toContain("Plate 04")
    expect(html).toContain("Diff")
    expect(html).toContain("+4 −7")
  })

  test("pads the index so the column cannot reflow", () => {
    expect(formatPlateIndex(4)).toBe("04")
    expect(formatPlateIndex(12)).toBe("12")
  })
})

describe("SectionCaption", () => {
  test("shows the fact when there is one", () => {
    const html = renderToStaticMarkup(<SectionCaption label="Branches" fact="12" />)
    expect(html).toContain("Branches")
    expect(html).toContain("12")
  })

  test("omits the fact rather than inventing one", () => {
    // Unlike a plate, a section can legitimately have nothing countable to say.
    const html = renderToStaticMarkup(<SectionCaption label="Worktree" />)
    expect(html).toContain("Worktree")
    expect(html).not.toContain("ml-auto")
  })

  test("uses tabular numerics so a live count does not jitter", () => {
    expect(renderToStaticMarkup(<SectionCaption label="Tasks" fact="3" />)).toContain("tabular-nums")
  })
})
