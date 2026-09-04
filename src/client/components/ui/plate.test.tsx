import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SectionCaption } from "./plate"

describe("SectionCaption", () => {
  test("shows the fact when there is one", () => {
    const html = renderToStaticMarkup(<SectionCaption label="Branches" fact="12" />)
    expect(html).toContain("Branches")
    expect(html).toContain("12")
  })

  test("omits the fact rather than inventing one", () => {
    const html = renderToStaticMarkup(<SectionCaption label="Worktree" />)
    expect(html).toContain("Worktree")
    expect(html).not.toContain("ml-auto")
  })

  test("uses tabular numerics so a live count does not jitter", () => {
    expect(renderToStaticMarkup(<SectionCaption label="Tasks" fact="3" />)).toContain("tabular-nums")
  })

  test("carries no box, radius, or shadow", () => {
    const html = renderToStaticMarkup(<SectionCaption label="Tasks" fact="3" />)
    expect(html).not.toMatch(/rounded|shadow|border-/)
  })
})
