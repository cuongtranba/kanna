import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { ContextWindowSnapshot } from "../../lib/contextWindow"
import { TooltipProvider } from "../ui/tooltip"
import { SessionTokenPill } from "./SessionTokenPill"

function renderPill(node: React.ReactNode): string {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
}

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

describe("SessionTokenPill", () => {
  test("returns nothing when no token activity yet", () => {
    const html = renderPill(<SessionTokenPill usage={null} />)
    expect(html).toBe("")
  })

  test("returns nothing when all token counters are zero", () => {
    const html = renderPill(
      <SessionTokenPill usage={snapshot({ usedTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })} />,
    )
    expect(html).toBe("")
  })

  test("renders in/out/cache stats with abbreviated counts", () => {
    const html = renderPill(
      <SessionTokenPill
        usage={snapshot({
          inputTokens: 30_000,
          outputTokens: 8_000,
          cachedInputTokens: 270_000,
        })}
      />,
    )
    expect(html).toContain("30k")
    expect(html).toContain("8k")
    expect(html).toContain("90%")
    expect(html).toContain("in")
    expect(html).toContain("out")
    expect(html).toContain("cache")
  })

  test("omits cache stat when cache hit cannot be derived", () => {
    const html = renderPill(
      <SessionTokenPill usage={snapshot({ outputTokens: 1234 })} />,
    )
    expect(html).toContain("1.2k")
    expect(html).not.toContain("cache")
  })

  test("aria-label describes input, output, cache totals", () => {
    const html = renderPill(
      <SessionTokenPill
        usage={snapshot({
          inputTokens: 1_000,
          outputTokens: 500,
          cachedInputTokens: 9_000,
        })}
      />,
    )
    expect(html).toContain("aria-label=")
    expect(html).toContain("Session tokens")
  })
})
