import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { PtyInstanceState } from "../../../shared/pty-instance"
import { formatBytes, formatPercent, PtyInstanceRow } from "./PtyInstancesIndicator"
import { TooltipProvider } from "../ui/tooltip"

function baseInstance(overrides: Partial<PtyInstanceState> = {}): PtyInstanceState {
  return {
    chatId: "chat-abc12345",
    sessionId: "session-1",
    pid: 4242,
    cwd: "/Users/me/Desktop/repo/kanna",
    model: "claude-sonnet-4-5",
    accountLabel: null,
    oauthMasked: null,
    phase: "streaming",
    startedAt: Date.now() - 5_000,
    lastEventAt: Date.now(),
    turnCount: 1,
    tokensIn: 0,
    tokensOut: 0,
    planMode: null,
    smokeTest: null,
    outputRingTail: null,
    exitedAt: null,
    exitCode: null,
    rssBytes: null,
    rssPeakBytes: null,
    cpuPercent: null,
    cpuPeakPercent: null,
    tuiStatus: null,
    ...overrides,
  }
}

function render(instance: PtyInstanceState): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null,
      createElement(PtyInstanceRow, {
        instance,
        onOpenChat: () => {},
        onCancel: () => {},
        onKill: () => {},
      }),
    ),
  )
}

describe("formatBytes", () => {
  test("renders bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })

  test("renders KB without decimals", () => {
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(900 * 1024)).toBe("900 KB")
  })

  test("renders MB without decimals", () => {
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB")
    expect(formatBytes(184 * 1024 * 1024)).toBe("184 MB")
  })

  test("renders GB with one decimal", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB")
    expect(formatBytes(Math.floor(1.5 * 1024 * 1024 * 1024))).toBe("1.5 GB")
  })
})

describe("formatPercent", () => {
  test("renders sub-10% with one decimal", () => {
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatPercent(5.234)).toBe("5.2%")
  })

  test("renders 10..99 with one decimal", () => {
    expect(formatPercent(42.78)).toBe("42.8%")
  })

  test("renders >=100 without decimals (multi-core)", () => {
    expect(formatPercent(180.4)).toBe("180%")
    expect(formatPercent(800)).toBe("800%")
  })
})

describe("PtyInstancesIndicatorView mem cell", () => {
  test("hides mem cell when rssBytes is null", () => {
    const html = render(baseInstance())
    expect(html).not.toContain(">mem<")
  })

  test("renders mem cell with current RSS when peak equals current", () => {
    const html = render(baseInstance({ rssBytes: 184 * 1024 * 1024, rssPeakBytes: 184 * 1024 * 1024 }))
    expect(html).toContain(">mem<")
    expect(html).toContain("184 MB")
    expect(html).not.toContain("peak 184")
  })

  test("renders peak suffix when peak exceeds current", () => {
    const html = render(baseInstance({
      rssBytes: 120 * 1024 * 1024,
      rssPeakBytes: 250 * 1024 * 1024,
    }))
    expect(html).toContain("120 MB")
    expect(html).toContain("peak 250 MB")
  })
})

describe("PtyInstancesIndicatorView cpu cell", () => {
  test("hides cpu cell when cpuPercent is null", () => {
    const html = render(baseInstance())
    expect(html).not.toContain(">cpu<")
  })

  test("renders cpu cell with current %, no peak when equal", () => {
    const html = render(baseInstance({ cpuPercent: 42.3, cpuPeakPercent: 42.3 }))
    expect(html).toContain(">cpu<")
    expect(html).toContain("42.3%")
    expect(html).not.toContain("peak 42")
  })

  test("renders peak suffix when peak exceeds current", () => {
    const html = render(baseInstance({ cpuPercent: 35.0, cpuPeakPercent: 180.0 }))
    expect(html).toContain("35.0%")
    expect(html).toContain("peak 180%")
  })
})
