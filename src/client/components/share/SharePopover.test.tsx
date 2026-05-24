import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { TooltipProvider } from "../ui/tooltip"
import { SharePopover } from "./SharePopover"
import type { ShareSummary } from "../../../shared/session-share/types"

const MOCK_SUMMARY: ShareSummary = {
  tokenId: "tok-1",
  chatId: "c1",
  url: "https://example.com/share/tok-1",
  expiresAt: Date.now() + 3_600_000 * 24,
  createdAt: Date.now(),
  revoked: false,
}

function makeTrigger() {
  return createElement("button", { "data-testid": "trigger" }, "Share")
}

async function mountSharePopover(props: {
  chatId: string
  tunnelUp: boolean
  shares: readonly ShareSummary[]
  onMint?: (chatId: string) => Promise<void>
  onRevoke?: (tokenId: string) => Promise<void>
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    const root = createRoot(container)
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SharePopover, {
          chatId: props.chatId,
          tunnelUp: props.tunnelUp,
          shares: props.shares,
          open: true,
          trigger: makeTrigger(),
          onMint: props.onMint ?? (async () => { /* noop */ }),
          onRevoke: props.onRevoke ?? (async () => { /* noop */ }),
          onOpenChange: () => { /* noop */ },
        }),
      ),
    )
  })
  return {
    container,
    cleanup: () => { container.remove() },
  }
}

describe("SharePopover", () => {
  test("shows NO_TUNNEL CTA when tunnel is down", async () => {
    const { cleanup } = await mountSharePopover({ chatId: "c1", tunnelUp: false, shares: [] })
    try {
      const bodyText = document.body.innerHTML
      expect(bodyText).toContain("tunnel")
      expect(bodyText).not.toContain("Create share link")
    } finally {
      cleanup()
    }
  })

  test("Mint click calls onMint with chatId", async () => {
    const calls: string[] = []
    const { cleanup } = await mountSharePopover({
      chatId: "c1",
      tunnelUp: true,
      shares: [],
      onMint: async (chatId: string) => { calls.push(chatId) },
    })
    try {
      const btn = document.body.querySelector("button[data-share-mint]") as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      expect(calls).toEqual(["c1"])
    } finally {
      cleanup()
    }
  })

  test("Renders active share with copy + revoke + expiry text", async () => {
    const { cleanup } = await mountSharePopover({
      chatId: "c1",
      tunnelUp: true,
      shares: [MOCK_SUMMARY],
    })
    try {
      const bodyText = document.body.innerHTML
      expect(bodyText).toContain("https://example.com/share/tok-1")
      expect(bodyText).toContain("Copy")
      expect(bodyText).toContain("Revoke")
      expect(bodyText).toContain("Expires in")
    } finally {
      cleanup()
    }
  })
})
