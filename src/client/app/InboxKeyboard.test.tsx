import { afterEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { DEFAULT_KEYBINDINGS } from "../../shared/app-settings-types"
import type { InboxProposal, InboxThread } from "../../shared/inbox/types"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { waitFor } from "../lib/testing/waitFor"
import type { WebSocketLike, WebSocketPort } from "../ports/webSocketPort"
import { useInboxStore } from "../stores/inboxStore"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { InboxPage } from "./InboxPage"
import { KannaSocketProvider } from "./KannaSocketProvider"
import { KannaSocket } from "./socket"

function thread(id: string, lastMessageAt: number, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id,
    sourceKind: "webhook",
    sourceId: "h1",
    sourceName: "CI",
    threadKey: id,
    sender: `sender-${id}`,
    messages: [{ id: `m-${id}`, deliveryId: "d", ts: lastMessageAt, payload: { text: "hi" }, preview: "hi" }],
    outbound: [],
    drafts: [],
    chatId: `chat-${id}`,
    state: "needs_you",
    unread: false,
    lastMessageAt,
    replyCount: 0,
    muted: false,
    ...overrides,
  }
}

const OPEN_PROPOSAL: InboxProposal = { id: "p1", text: "On my way", confidence: 0.9, reason: "asked", at: 1, status: "open" }

function PageUnderTest() {
  const segments = useLocation().pathname.split("/")
  return <InboxPage threadId={segments[2] ?? null} />
}

async function mount(threads: InboxThread[]) {
  const sent: string[] = []
  const ws: WebSocketLike = { readyState: 1, send: (data) => { sent.push(data) }, close: () => {}, addEventListener: () => {} }
  const webSocket: WebSocketPort = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, create: () => ws }
  const socket = new KannaSocket("ws://localhost/ws", { dom: makeFakeDomPort(), timer: makeFakeTimerPort(), webSocket })
  socket.start()
  useInboxStore.getState().applySnapshot({ threads, items: [], unreadCount: 0, total: threads.length })
  const rendered = await renderClientMarkup(
    <MemoryRouter initialEntries={["/inbox"]}>
      <KannaSocketProvider socket={socket}>
        <PageUnderTest />
      </KannaSocketProvider>
    </MemoryRouter>,
  )
  const commands = () => sent
    .map((frame) => JSON.parse(frame))
    .filter((envelope) => envelope.type === "command")
    .map((envelope) => envelope.command)
  return {
    ...rendered,
    commands,
    cleanup: async () => {
      await rendered.cleanup()
      socket.dispose()
    },
  }
}

function press(key: string, target: EventTarget = window) {
  return act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
}

const selected = () => useInboxStore.getState().selectedThreadId

const KEYBOARD_INITIAL = useKannaStateStore.getInitialState()

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
  useKannaStateStore.setState(KEYBOARD_INITIAL)
})

describe("inbox keyboard", () => {
  test("the defaults are j k r e a", () => {
    expect([
      DEFAULT_KEYBINDINGS.inboxNextThread,
      DEFAULT_KEYBINDINGS.inboxPrevThread,
      DEFAULT_KEYBINDINGS.inboxFocusComposer,
      DEFAULT_KEYBINDINGS.inboxArchiveThread,
      DEFAULT_KEYBINDINGS.inboxApproveProposal,
    ]).toEqual([["j"], ["k"], ["r"], ["e"], ["a"]])
  })

  test("j and k walk the threads in the order they are listed", async () => {
    const { cleanup } = await mount([thread("t1", 3000), thread("t2", 2000), thread("t3", 1000)])
    try {
      await press("j")
      await waitFor(() => selected() === "t1", 2000, "the first thread")
      await press("j")
      await waitFor(() => selected() === "t2", 2000, "the second thread")
      await press("k")
      await waitFor(() => selected() === "t1", 2000, "back to the first thread")
      await press("k")
      expect(selected()).toBe("t1")
    } finally {
      await cleanup()
    }
  })

  test("r focuses the reply box of the open thread", async () => {
    const { container, cleanup } = await mount([thread("t1", 3000)])
    try {
      await press("r")
      expect(document.activeElement).not.toBeInstanceOf(HTMLTextAreaElement)
      await press("j")
      await waitFor(() => selected() === "t1" && container.querySelector("textarea") !== null, 2000, "the composer")
      await press("r")
      expect(document.activeElement).toBe(container.querySelector("textarea[aria-label='Reply to the sender']"))
    } finally {
      await cleanup()
    }
  })

  test("e archives the open thread and closes it", async () => {
    const { commands, cleanup } = await mount([thread("t1", 3000), thread("t2", 2000)])
    try {
      await press("e")
      expect(commands()).toEqual([])
      await press("j")
      await waitFor(() => selected() === "t1", 2000, "the first thread")
      await press("e")
      await waitFor(() => commands().length === 1, 2000, "the archive command")
      expect(commands()).toEqual([{ type: "inbox.archive", threadId: "t1" }])
    } finally {
      await cleanup()
    }
  })

  test("Escape closes the open thread unless a box has focus", async () => {
    const { container, cleanup } = await mount([thread("t1", 3000)])
    try {
      await press("j")
      await waitFor(() => selected() === "t1" && container.querySelector("textarea") !== null, 2000, "the composer")
      const box = container.querySelector("textarea")
      if (box === null) throw new Error("no composer")
      await press("Escape", box)
      expect(selected()).toBe("t1")
      await press("Escape")
      await waitFor(() => selected() === null, 2000, "the thread closed")
    } finally {
      await cleanup()
    }
  })

  test("Escape closes an open popover before the thread under it", async () => {
    const { cleanup } = await mount([thread("t1", 3000)])
    const dismissLayer = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault()
    }
    try {
      await press("j")
      await waitFor(() => selected() === "t1", 2000, "the thread")
      document.addEventListener("keydown", dismissLayer, { capture: true })
      await press("Escape", document.body)
      expect(selected()).toBe("t1")
      document.removeEventListener("keydown", dismissLayer, { capture: true })
      await press("Escape", document.body)
      await waitFor(() => selected() === null, 2000, "the thread closed")
    } finally {
      document.removeEventListener("keydown", dismissLayer, { capture: true })
      await cleanup()
    }
  })

  test("a sends the open proposal and does nothing when there is none", async () => {
    const { commands, cleanup } = await mount([thread("t1", 3000), thread("t2", 2000, { proposal: OPEN_PROPOSAL })])
    try {
      await press("j")
      await waitFor(() => selected() === "t1", 2000, "the thread without a proposal")
      await press("a")
      expect(commands()).toEqual([])
      await press("j")
      await waitFor(() => selected() === "t2", 2000, "the thread with a proposal")
      await press("a")
      await waitFor(() => commands().length === 1, 2000, "the approve command")
      expect(commands()).toEqual([{ type: "inbox.approveProposal", threadId: "t2", proposalId: "p1" }])
    } finally {
      await cleanup()
    }
  })

  test("typing in the reply box never triggers a shortcut", async () => {
    const { container, commands, cleanup } = await mount([thread("t1", 3000, { proposal: OPEN_PROPOSAL }), thread("t2", 2000)])
    try {
      await press("j")
      await waitFor(() => selected() === "t1" && container.querySelector("textarea") !== null, 2000, "the composer")
      const box = container.querySelector("textarea")
      if (box === null) throw new Error("no composer")
      for (const key of ["j", "k", "e", "a", "r"]) await press(key, box)
      expect(selected()).toBe("t1")
      expect(commands()).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("a rebound key replaces the default one", async () => {
    useKannaStateStore.getState().setKeybindings({
      bindings: { ...DEFAULT_KEYBINDINGS, inboxNextThread: ["n"] },
      warning: null,
      filePathDisplay: "",
    })
    const { cleanup } = await mount([thread("t1", 3000)])
    try {
      await press("j")
      expect(selected()).toBeNull()
      await press("n")
      await waitFor(() => selected() === "t1", 2000, "the rebound key")
    } finally {
      await cleanup()
    }
  })
})
