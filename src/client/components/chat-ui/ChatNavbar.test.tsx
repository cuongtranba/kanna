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
