import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { SessionTotals } from "../../lib/contextWindow"
import { SessionTokenPill } from "./SessionTokenPill"

function renderPill(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
}

function totals(partial: Partial<SessionTotals>): SessionTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    cacheHitPercentage: null,
    ...partial,
  }
}

describe("SessionTokenPill", () => {
  test("returns nothing when totals is null", () => {
    const html = renderPill(<SessionTokenPill totals={null} />)
    expect(html).toBe("")
  })

  test("renders cumulative in/out from totals", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 30_000, outputTokens: 8_000 })}
      />,
    )
    expect(html).toContain("30k")
    expect(html).toContain("8k")
    expect(html).toContain("in")
    expect(html).toContain("out")
  })

  test("renders cost when costUsd > 0", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 10_000, outputTokens: 2_000, costUsd: 0.42 })}
      />,
    )
    expect(html).toContain("$0.42")
  })

  test("omits cost stat when costUsd is 0", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 10_000, outputTokens: 2_000, costUsd: 0 })}
      />,
    )
    expect(html).not.toContain("$")
  })

  test("renders cache hit percentage when cacheHitPercentage is non-null", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 30_000, outputTokens: 8_000, cachedTokens: 270_000, cacheHitPercentage: 90 })}
      />,
    )
    expect(html).toContain("90%")
    expect(html).toContain("cache")
  })

  test("omits cache stat when cacheHitPercentage is null", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ outputTokens: 1234 })}
      />,
    )
    expect(html).toContain("1.2k")
    expect(html).not.toContain("cache")
  })

  test("aria-label includes cost when present", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 1_000, outputTokens: 500, costUsd: 0.42 })}
      />,
    )
    expect(html).toContain("aria-label=")
    expect(html).toContain("Session tokens")
    expect(html).toContain("$0.42")
  })

  test("aria-label omits cost when costUsd is 0", () => {
    const html = renderPill(
      <SessionTokenPill
        totals={totals({ inputTokens: 1_000, outputTokens: 500, costUsd: 0 })}
      />,
    )
    expect(html).toContain("aria-label=")
    expect(html).not.toContain("$")
  })

  test("renders a tappable button (popover trigger, not a tooltip)", () => {
    const html = renderPill(
      <SessionTokenPill totals={totals({ inputTokens: 100, outputTokens: 20 })} />,
    )
    // Popover trigger: cursor-pointer + touch-manipulation, no cursor-default.
    expect(html).toContain("cursor-pointer")
    expect(html).toContain("touch-manipulation")
    expect(html).not.toContain("cursor-default")
    // Radix popover trigger annotates the button with aria-expanded / data-state.
    expect(html).toMatch(/aria-expanded=/)
    expect(html).toMatch(/data-state="closed"/)
  })
})
