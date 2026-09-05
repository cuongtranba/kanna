import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { ChatNavbar } from "./ChatNavbar"
import { TooltipProvider } from "../ui/tooltip"
import { useFollowedSessionsStore } from "../../stores/followedSessionsStore"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"

function baseProps() {
  return {
    sidebarCollapsed: false,
    onOpenSidebar: () => {},
    onExpandSidebar: () => {},
    onNewChat: () => {},
    currentChatId: "chat-1",
  }
}

describe("ChatNavbar silent toggle", () => {
  test("renders Bell button when onToggleSilent is provided (silent=false)", async () => {
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} silent={false} onToggleSilent={() => {}} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      const btn = document.querySelector('[aria-label="Silence notifications"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      expect(btn?.getAttribute("aria-pressed")).toBe("false")
    } finally {
      await r.cleanup()
    }
  })

  test("renders BellOff button when silent=true", async () => {
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} silent={true} onToggleSilent={() => {}} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      const btn = document.querySelector('[aria-label="Unsilence notifications"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      expect(btn?.getAttribute("aria-pressed")).toBe("true")
    } finally {
      await r.cleanup()
    }
  })

  test("calls onToggleSilent when button is clicked", async () => {
    let called = 0
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} silent={false} onToggleSilent={() => { called++ }} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      const btn = document.querySelector('[aria-label="Silence notifications"]') as HTMLButtonElement | null
      btn?.click()
      expect(called).toBe(1)
    } finally {
      await r.cleanup()
    }
  })

  test("no bell button when onToggleSilent is not provided", async () => {
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(document.querySelector('[aria-label="Silence notifications"]')).toBeNull()
      expect(document.querySelector('[aria-label="Unsilence notifications"]')).toBeNull()
    } finally {
      await r.cleanup()
    }
  })
})

describe("ChatNavbar layout – bell icon width and status row overflow", () => {
  test("bell icon uses size-4.5 for width parity with other toolbar icons", async () => {
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} silent={true} onToggleSilent={() => {}} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      const btn = document.querySelector('[aria-label="Unsilence notifications"]') as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      const svg = btn?.querySelector("svg")
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute("class") ?? "").toContain("size-4.5")
    } finally {
      await r.cleanup()
    }
  })

  test("live status inner row has min-w-0 to allow shrinking below intrinsic width", async () => {
    const timings = {
      derivedAtMs: 12_000,
      stateEnteredAt: 0,
      activeSessionStartedAt: 0,
      chatCreatedAt: 0,
      cumulativeMs: { idle: 0, starting: 0, running: 12_000, waiting_for_user: 0, failed: 0 },
      lastTurnDurationMs: null,
    }
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} timings={timings} status="running" />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      const el = document.querySelector('[class*="cursor-default"]') as HTMLElement | null
      expect(el).not.toBeNull()
      expect(el?.className ?? "").toContain("min-w-0")
    } finally {
      await r.cleanup()
    }
  })
})

describe("ChatNavbar following pill", () => {
  test("hidden when chat is not followed, no render loop", async () => {
    useFollowedSessionsStore.getState().setFollowed([])
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).not.toContain("following")
    } finally {
      await r.cleanup()
    }
  })

  test("shown when the active chat is followed, no render loop", async () => {
    useFollowedSessionsStore.getState().setFollowed(["chat-1"])
    const r = await renderForLoopCheck(
      <ChatTabScopedStore.Provider init={undefined}>
        <TooltipProvider>
          <ChatNavbar {...baseProps()} />
        </TooltipProvider>
      </ChatTabScopedStore.Provider>,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("following")
    } finally {
      await r.cleanup()
      useFollowedSessionsStore.getState().setFollowed([])
    }
  })
})
