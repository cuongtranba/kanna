import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { ChatNavbar } from "./ChatNavbar"
import { TooltipProvider } from "../ui/tooltip"
import { useFollowedSessionsStore } from "../../stores/followedSessionsStore"

function baseProps() {
  return {
    sidebarCollapsed: false,
    onOpenSidebar: () => {},
    onExpandSidebar: () => {},
    onNewChat: () => {},
    currentChatId: "chat-1",
  }
}

describe("ChatNavbar following pill", () => {
  test("hidden when chat is not followed, no render loop", async () => {
    useFollowedSessionsStore.getState().setFollowed([])
    const r = await renderForLoopCheck(
      <TooltipProvider>
        <ChatNavbar {...baseProps()} />
      </TooltipProvider>,
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
      <TooltipProvider>
        <ChatNavbar {...baseProps()} />
      </TooltipProvider>,
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
