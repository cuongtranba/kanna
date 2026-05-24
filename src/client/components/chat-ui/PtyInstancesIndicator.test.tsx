import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { PtyInstanceState } from "../../../shared/pty-instance"
import { formatBytes, PtyInstanceRow } from "./PtyInstancesIndicator"
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
