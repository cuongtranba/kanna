import { beforeEach, describe, expect, test } from "bun:test"
import { createElement, useState } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { TooltipProvider } from "../ui/tooltip"
import { SharePopover, SharePopoverBody } from "./SharePopover"
import { ShareButton } from "./ShareButton"
import type { ShareSummary } from "../../../shared/session-share/types"

const FIXED_NOW = 1_700_000_000_000

const MOCK_SUMMARY: ShareSummary = {
  tokenId: "tok-1",
  chatId: "c1",
  url: "https://example.com/share/tok-1",
  expiresAt: FIXED_NOW + 3_600_000 * 24,
  createdAt: FIXED_NOW,
  revoked: false,
}

async function mountBody(props: {
  chatId: string
  shares: readonly ShareSummary[]
  onMint?: (chatId: string) => Promise<void>
  onRevoke?: (tokenId: string) => Promise<void>
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(SharePopoverBody, {
        chatId: props.chatId,
        shares: props.shares,
        now: FIXED_NOW,
        onMint: props.onMint ?? (async () => { }),
        onRevoke: props.onRevoke ?? (async () => { }),
      }),
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

describe("SharePopoverBody", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("renders Create share link button when no shares exist", async () => {
    const { container, cleanup } = await mountBody({ chatId: "c1", shares: [] })
    try {
      const html = container.innerHTML
      expect(html).toContain("Create share link")
      expect(html).toContain("No active share links")
    } finally {
      cleanup()
    }
  })

  test("Mint click calls onMint with chatId", async () => {
    const calls: string[] = []
    const { container, cleanup } = await mountBody({
      chatId: "c1",
      shares: [],
      onMint: async (chatId: string) => { calls.push(chatId) },
    })
    try {
      const btn = container.querySelector("button[data-share-mint]") as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      expect(calls).toEqual(["c1"])
    } finally {
      cleanup()
    }
  })

  test("Mint disables the button while in flight and re-enables it after settle", async () => {
    let release: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => { release = resolve })
    const { container, cleanup } = await mountBody({
      chatId: "c1",
      shares: [],
      onMint: async () => inFlight,
    })
    try {
      const btn = () => container.querySelector("button[data-share-mint]") as HTMLButtonElement
      expect(btn().disabled).toBe(false)

      await act(async () => { btn().click() })
      expect(btn().disabled).toBe(true)
      expect(container.innerHTML).toContain("Creating…")

      await act(async () => { release!(); await inFlight })
      expect(btn().disabled).toBe(false)
      expect(container.innerHTML).toContain("Create share link")
    } finally {
      cleanup()
    }
  })

  test("Mint re-enables the button when onMint rejects", async () => {
    const { container, cleanup } = await mountBody({
      chatId: "c1",
      shares: [],
      onMint: async () => { throw new Error("mint failed") },
    })
    try {
      const btn = () => container.querySelector("button[data-share-mint]") as HTMLButtonElement
      await act(async () => { btn().click() })
      expect(btn().disabled).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("Renders active share with copy + revoke + expiry text", async () => {
    const { container, cleanup } = await mountBody({
      chatId: "c1",
      shares: [MOCK_SUMMARY],
    })
    try {
      const html = container.innerHTML
      expect(html).toContain("https://example.com/share/tok-1")
      expect(html).toContain("Copy")
      expect(html).toContain("Revoke")
      expect(html).toContain("Expires in")
    } finally {
      cleanup()
    }
  })

  test("Trigger click toggles popover open (regression: asChild composition)", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      let openState = false
      const setOpen = (next: boolean) => { openState = next }
      function Harness() {
        const [open, setOpenInner] = useState(false)
        return createElement(SharePopover, {
          chatId: "c1",
          shares: [],
          open,
          onOpenChange: (next: boolean) => {
            setOpenInner(next)
            setOpen(next)
          },
          trigger: createElement(ShareButton),
          onMint: async () => { },
          onRevoke: async () => { },
        })
      }
      await act(async () => {
        root.render(createElement(TooltipProvider, null, createElement(Harness)))
      })
      const btn = container.querySelector("button[aria-label='Public link']") as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      expect(openState).toBe(true)
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })

  test("Revoke click calls onRevoke with tokenId", async () => {
    const calls: string[] = []
    const { container, cleanup } = await mountBody({
      chatId: "c1",
      shares: [MOCK_SUMMARY],
      onRevoke: async (tokenId: string) => { calls.push(tokenId) },
    })
    try {
      const btn = container.querySelector("button[data-share-revoke]") as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      await act(async () => {
        btn!.click()
      })
      expect(calls).toEqual(["tok-1"])
    } finally {
      cleanup()
    }
  })
})
