import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TurnDurationFooter } from "./TurnDurationFooter"

describe("TurnDurationFooter", () => {
  test("renders nothing when durationMs is zero", () => {
    expect(renderToStaticMarkup(<TurnDurationFooter durationMs={0} />)).toBe("")
  })

  test("renders nothing when durationMs is negative", () => {
    expect(renderToStaticMarkup(<TurnDurationFooter durationMs={-50} />)).toBe("")
  })

  test("uses default prefix Worked for", () => {
    const html = renderToStaticMarkup(<TurnDurationFooter durationMs={3000} />)
    expect(html).toContain("Worked for 3s")
  })

  test("respects custom prefix", () => {
    const html = renderToStaticMarkup(<TurnDurationFooter durationMs={3000} prefix="Failed after" />)
    expect(html).toContain("Failed after 3s")
    expect(html).not.toContain("Worked for")
  })

  test("formats sub-second as ms", () => {
    const html = renderToStaticMarkup(<TurnDurationFooter durationMs={250} />)
    expect(html).toContain("250ms")
  })

  test("formats minutes with seconds", () => {
    const html = renderToStaticMarkup(<TurnDurationFooter durationMs={90_000} />)
    expect(html).toContain("1m 30s")
  })

  test("formats hours with minutes", () => {
    const html = renderToStaticMarkup(<TurnDurationFooter durationMs={3_660_000} />)
    expect(html).toContain("1h 1m")
  })
})
