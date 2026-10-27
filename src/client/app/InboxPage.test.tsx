import { afterEach, describe, expect, test } from "vite-plus/test"
import { MemoryRouter } from "react-router-dom"
import type { InboxActivityItem, InboxThread } from "../../shared/inbox/types"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { useInboxStore } from "../stores/inboxStore"
import { InboxPage } from "./InboxPage"

function thread(id: string, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id,
    sourceKind: "webhook",
    sourceId: "h1",
    sourceName: "CI",
    threadKey: id,
    sender: `sender-${id}`,
    messages: [{ id: `m-${id}`, deliveryId: "d", ts: 1, payload: { text: "build failed" }, preview: "build failed" }],
    state: "needs_you",
    unread: true,
    lastMessageAt: 1_000,
    replyCount: 0,
    ...overrides,
  }
}

function item(id: string, overrides: Partial<InboxActivityItem> = {}): InboxActivityItem {
  return {
    id,
    ts: 900,
    subject: "kanna.turn.failed",
    source: { kind: "store", log: "turns" },
    title: "Turn failed",
    preview: "boom",
    payload: {},
    attention: true,
    unread: true,
    ...overrides,
  }
}

function mount(threadId: string | null) {
  return renderClientMarkup(
    <MemoryRouter>
      <InboxPage threadId={threadId} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

describe("InboxPage", () => {
  test("an empty inbox says nothing needs you and links to the places that feed it", async () => {
    const { container, cleanup } = await mount(null)
    try {
      expect(container.textContent).toContain("Nothing needs you. Webhooks and MCP sources land here.")
      expect(container.querySelector("a[href='/webhooks']")).not.toBeNull()
      expect(container.querySelector("a[href='/settings/mcp-servers']")).not.toBeNull()
    } finally {
      await cleanup()
    }
  })

  test("lists threads and attention items and opens the selected thread's agent read", async () => {
    useInboxStore.getState().applySnapshot({
      threads: [
        thread("t1", {
          unread: false,
          chatId: "c1",
          report: { verdict: "needs_you", summary: "Pay the invoice", at: 1, chatId: "c1" },
        }),
      ],
      items: [item("i1"), item("i2", { attention: false, title: "Turn finished" })],
      unreadCount: 2,
      total: 3,
    })
    const { container, cleanup } = await mount("t1")
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("sender-t1")
      expect(text).toContain("Turn failed")
      expect(text).not.toContain("Turn finished")
      expect(text).toContain("Agent's read")
      expect(text).toContain("Pay the invoice")
      expect(container.querySelector("a[href='/chat/c1']")?.textContent).toContain("Open chat")
    } finally {
      await cleanup()
    }
  })
})
