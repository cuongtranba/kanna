import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { ContextWindowSnapshot } from "../../lib/contextWindow"
import { ContextWindowMeter } from "./ContextWindowMeter"

function snapshot(partial: Partial<ContextWindowSnapshot>): ContextWindowSnapshot {
  return {
    usedTokens: 0,
    compactsAutomatically: false,
    remainingTokens: null,
    usedPercentage: null,
    remainingPercentage: null,
    updatedAt: new Date(0).toISOString(),
    ...partial,
  }
}

describe("ContextWindowMeter", () => {
  test("renders a tappable popover trigger (>=36px tap target, touch-manipulation)", () => {
    const html = renderToStaticMarkup(
      <ContextWindowMeter usage={snapshot({ usedTokens: 50_000, maxTokens: 200_000, usedPercentage: 25 })} />,
    )
    expect(html).toContain("cursor-pointer")
    expect(html).toContain("touch-manipulation")
    expect(html).toContain("h-9 w-9")
    expect(html).toMatch(/aria-expanded=/)
    expect(html).toMatch(/data-state="closed"/)
  })

  test("renders percentage label inside the visible circle", () => {
    const html = renderToStaticMarkup(
      <ContextWindowMeter usage={snapshot({ usedTokens: 50_000, maxTokens: 200_000, usedPercentage: 25 })} />,
    )
    expect(html).toContain(">25<")
    expect(html).toContain("aria-label=\"Context window 25% used\"")
  })
})
