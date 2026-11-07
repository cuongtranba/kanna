import { afterEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import type { InboxOutboundMessage, InboxThread } from "../../shared/inbox/types"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { waitFor } from "../lib/testing/waitFor"
import type { WebSocketLike, WebSocketPort } from "../ports/webSocketPort"
import { useInboxStore } from "../stores/inboxStore"
import { InboxThreadDetail } from "./InboxThreadDetail"
import { KannaSocketProvider } from "./KannaSocketProvider"
import { KannaSocket } from "./socket"

function outbound(overrides: Partial<InboxOutboundMessage>): InboxOutboundMessage {
  return { id: "o1", ts: 2000, text: "on my way", by: "you", status: "sent", ...overrides }
}

function thread(outboundMessages: InboxOutboundMessage[]): InboxThread {
  return {
    id: "t1",
    sourceKind: "mcp",
    sourceId: "src1",
    sourceName: "Zalo",
    threadKey: "k",
    sender: "ada",
    messages: [
      { id: "m1", deliveryId: "d1", ts: 1000, payload: { text: "where are you" }, preview: "where are you" },
      { id: "m2", deliveryId: "d2", ts: 3000, payload: { text: "hello?" }, preview: "hello?" },
    ],
    outbound: outboundMessages,
    drafts: [],
    state: "needs_you",
    unread: false,
    lastMessageAt: 3000,
    replyCount: 0,
    muted: false,
  }
}

function recordingSocket() {
  const sent: string[] = []
  const ws: WebSocketLike = {
    readyState: 1,
    send: (data) => { sent.push(data) },
    close: () => {},
    addEventListener: () => {},
  }
  const webSocket: WebSocketPort = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, create: () => ws }
  const socket = new KannaSocket("ws://localhost/ws", { dom: makeFakeDomPort(), timer: makeFakeTimerPort(), webSocket })
  socket.start()
  return { socket, sent }
}

function sentCommands(sent: string[]) {
  return sent.map((frame) => JSON.parse(frame)).filter((envelope) => envelope.type === "command").map((envelope) => envelope.command)
}

async function mount(target: InboxThread) {
  const { socket, sent } = recordingSocket()
  const rendered = await renderClientMarkup(
    <MemoryRouter>
      <KannaSocketProvider socket={socket}>
        <InboxThreadDetail thread={target} prevId={null} nextId={null} onOpenThread={() => {}} onBack={() => {}} onArchived={() => {}} onSnoozed={() => {}} />
      </KannaSocketProvider>
    </MemoryRouter>,
  )
  return {
    ...rendered,
    sent,
    cleanup: async () => {
      await rendered.cleanup()
      socket.dispose()
    },
  }
}

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)
  if (!match) throw new Error(`No button labelled ${label}`)
  return match
}

function click(button: HTMLButtonElement) {
  return act(async () => {
    button.click()
  })
}

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

describe("InboxThreadDetail outbound messages", () => {
  test("interleaves what you sent with what arrived, by time, and shows each status", async () => {
    const { container, cleanup } = await mount(thread([outbound({ status: "pending" })]))
    try {
      const rows = [...container.querySelectorAll("section[aria-label='Messages'] li")].map((row) => row.textContent ?? "")
      expect(rows).toHaveLength(3)
      expect(rows[0]).toContain("where are you")
      expect(rows[1]).toContain("You")
      expect(rows[1]).toContain("on my way")
      expect(rows[1]).toContain("Sending…")
      expect(rows[2]).toContain("hello?")
    } finally {
      await cleanup()
    }
  })

  test("a bubble shows the full message text with its line breaks and falls back to the preview for older messages", async () => {
    const target = thread([])
    const [first, second] = target.messages
    if (first === undefined || second === undefined) throw new Error("fixture needs two messages")
    target.messages = [{ ...first, preview: "first line second line", text: "first line\nsecond line" }, second]
    const { container, cleanup } = await mount(target)
    try {
      const bubbles = [...container.querySelectorAll("section[aria-label='Messages'] li p")].map((bubble) => bubble.textContent)
      expect(bubbles).toEqual(["first line\nsecond line", "hello?"])
    } finally {
      await cleanup()
    }
  })

  test("a failed send shows its reason and Retry sends it again at once", async () => {
    const { container, sent, cleanup } = await mount(thread([outbound({ status: "failed", error: "Tool rejected the call" })]))
    try {
      expect(container.textContent).toContain("Failed: Tool rejected the call")
      await click(buttonLabelled(container, "Retry"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the retry command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.retrySend", threadId: "t1", outboundId: "o1" }])
    } finally {
      await cleanup()
    }
  })

  test("an unconfirmed send warns it may send twice and only retries after you confirm", async () => {
    const { container, sent, cleanup } = await mount(thread([outbound({ status: "unknown" })]))
    try {
      expect(container.textContent).toContain("Not confirmed")
      await click(buttonLabelled(container, "Retry"))
      expect(container.textContent).toContain("may deliver this message twice")
      expect(sentCommands(sent)).toEqual([])
      await click(buttonLabelled(container, "Cancel"))
      expect(container.textContent).not.toContain("may deliver this message twice")
      await click(buttonLabelled(container, "Retry"))
      await click(buttonLabelled(container, "Send again"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the confirmed retry command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.retrySend", threadId: "t1", outboundId: "o1", confirmDuplicate: true }])
    } finally {
      await cleanup()
    }
  })

  test("a failed message that was already retried has no Retry", async () => {
    const original = outbound({ id: "o1", status: "failed", error: "recipient is blocked" })
    const retry = outbound({ id: "o2", ts: 2500, status: "pending", retryOf: "o1" })
    const { container, cleanup } = await mount(thread([original, retry]))
    try {
      expect(container.textContent).toContain("Failed: recipient is blocked")
      expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Retry")).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test("a sent message has no Retry", async () => {
    const { container, cleanup } = await mount(thread([outbound({ status: "sent" })]))
    try {
      expect(container.textContent).toContain("Sent")
      expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Retry")).toBe(false)
    } finally {
      await cleanup()
    }
  })
})

describe("InboxThreadDetail snooze", () => {
  test("Snooze in the header offers the presets and snoozes the thread until the pick", async () => {
    const { socket, sent } = recordingSocket()
    const rendered = await renderClientMarkup(
      <MemoryRouter>
        <KannaSocketProvider socket={socket}>
          <InboxThreadDetail thread={thread([])} prevId={null} nextId={null} onOpenThread={() => {}} onBack={() => {}} onArchived={() => {}} onSnoozed={() => {}} />
        </KannaSocketProvider>
      </MemoryRouter>,
    )
    try {
      await click(buttonLabelled(rendered.container, "Snooze"))
      const menu = document.body.textContent ?? ""
      for (const label of ["Later today", "Tomorrow", "Next week", "Pick a time"]) expect(menu).toContain(label)
      const tomorrow = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Tomorrow"))
      if (!tomorrow) throw new Error("No Tomorrow preset")
      await click(tomorrow)
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the snooze command")
      const [command] = sentCommands(sent)
      expect(command).toMatchObject({ type: "inbox.snooze", threadIds: ["t1"] })
      expect(command.until).toBeGreaterThan(Date.now())
    } finally {
      await rendered.cleanup()
      socket.dispose()
    }
  })

  test("a snoozed thread says when it wakes and Unsnooze brings it back at once", async () => {
    const snoozedThread = { ...thread([]), snoozedUntil: Date.now() + 3_600_000 }
    const { container, sent, cleanup } = await mount(snoozedThread)
    try {
      expect(container.textContent).toContain("Snoozed until")
      await click(buttonLabelled(container, "Unsnooze"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the unsnooze command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.unsnooze", threadId: "t1" }])
    } finally {
      await cleanup()
    }
  })
})
