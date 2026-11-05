import { afterEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import type { InboxThread } from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"
import { defaultAppSettingsSnapshot } from "../../server/app-settings"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { waitFor } from "../lib/testing/waitFor"
import type { WebSocketLike, WebSocketPort } from "../ports/webSocketPort"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useInboxStore } from "../stores/inboxStore"
import { InboxReplyComposer } from "./InboxReplyComposer"
import { KannaSocketProvider } from "./KannaSocketProvider"
import { KannaSocket } from "./socket"

const REPLY_TARGET: McpSource["reply"] = { tool: "send", args: { text: "{{reply.text}}" }, resultIdPath: "" }

function mcpSource(reply: McpSource["reply"]): McpSource {
  return {
    id: "src1",
    name: "Zalo",
    mode: "subscribe",
    serverId: "srv",
    enabled: true,
    threadKeyPath: "threadId",
    senderPath: "senderName",
    textPath: "",
    handler: { mode: "notify", template: "t", replyHint: "", pushEnabled: true },
    reply,
    resourceUris: ["zalo://inbox"],
    itemsPath: "messages",
    itemKeyPath: "id",
    resyncIntervalMs: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function setMcpSources(sources: McpSource[]) {
  useAppSettingsStore.getState().setFromServer({ ...defaultAppSettingsSnapshot(), mcpSources: sources })
}

function mcpThread(overrides: Partial<InboxThread> = {}): InboxThread {
  return thread({ sourceKind: "mcp", sourceId: "src1", sourceName: "Zalo", ...overrides })
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
  const socket = new KannaSocket("ws://localhost/ws", {
    dom: makeFakeDomPort(),
    timer: makeFakeTimerPort(),
    webSocket,
  })
  socket.start()
  return { socket, sent }
}

function pressEnter(textarea: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  return act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }))
  })
}

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: "t1",
    sourceKind: "webhook",
    sourceId: "h1",
    sourceName: "CI",
    threadKey: "k",
    sender: "ada",
    messages: [],
    outbound: [],
    state: "needs_you",
    unread: true,
    lastMessageAt: 1,
    replyCount: 0,
    ...overrides,
  }
}

function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)
  if (!match) throw new Error(`No button labelled ${label}`)
  return match
}

const APP_SETTINGS_INITIAL = useAppSettingsStore.getInitialState()

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
  useAppSettingsStore.setState(APP_SETTINGS_INITIAL)
})

function sentCommands(sent: string[]) {
  return sent.map((frame) => JSON.parse(frame)).filter((envelope) => envelope.type === "command").map((envelope) => envelope.command)
}

describe("InboxReplyComposer", () => {
  test("a thread with no chat cannot be replied to and says why", async () => {
    const { container, cleanup } = await renderClientMarkup(
      <InboxReplyComposer thread={thread({})} onArchived={() => {}} />,
    )
    try {
      expect(buttonLabelled(container, "Send").disabled).toBe(true)
      expect(buttonLabelled(container, "Instruct").disabled).toBe(true)
      expect(container.querySelector("textarea")?.disabled).toBe(true)
      expect(container.textContent).toContain("nobody to reply through")
      expect(container.querySelectorAll("[data-state='closed']").length).toBeGreaterThanOrEqual(2)
    } finally {
      await cleanup()
    }
  })

  test("seeds the textarea with the agent's draft and lets the agent send it once a chat handles the thread", async () => {
    const withDraft = thread({
      chatId: "c1",
      report: { verdict: "needs_you", summary: "Pay it", draftReply: "On it, thanks", at: 1, chatId: "c1" },
    })
    const { container, cleanup } = await renderClientMarkup(<InboxReplyComposer thread={withDraft} onArchived={() => {}} />)
    try {
      expect(container.querySelector("textarea")?.value).toBe("On it, thanks")
      expect(buttonLabelled(container, "Agent will send").disabled).toBe(false)
      expect(container.textContent).not.toContain("nobody to reply through")
    } finally {
      await cleanup()
    }
  })

  test("discarding the draft leaves an empty box instead of re-seeding the agent's text", async () => {
    const withDraft = thread({
      chatId: "c1",
      report: { verdict: "needs_you", summary: "Pay it", draftReply: "On it, thanks", at: 1, chatId: "c1" },
    })
    useInboxStore.getState().clearReplyDraft("t1")
    const { container, cleanup } = await renderClientMarkup(<InboxReplyComposer thread={withDraft} onArchived={() => {}} />)
    try {
      expect(container.querySelector("textarea")?.value).toBe("")
      expect(buttonLabelled(container, "Agent will send").disabled).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("a notify thread whose source has a reply target can be sent to directly", async () => {
    setMcpSources([mcpSource(REPLY_TARGET)])
    useInboxStore.getState().setReplyDraft("t1", "hello")
    const { container, cleanup } = await renderClientMarkup(<InboxReplyComposer thread={mcpThread()} onArchived={() => {}} />)
    try {
      expect(container.querySelector("textarea")?.disabled).toBe(false)
      expect(buttonLabelled(container, "Send").disabled).toBe(false)
      expect(buttonLabelled(container, "Instruct").disabled).toBe(true)
      expect(container.textContent).not.toContain("nobody to reply through")
    } finally {
      await cleanup()
    }
  })

  test("a thread handled by a chat says the agent will send it", async () => {
    setMcpSources([mcpSource(null)])
    useInboxStore.getState().setReplyDraft("t1", "hello")
    const { container, cleanup } = await renderClientMarkup(
      <InboxReplyComposer thread={mcpThread({ chatId: "c1" })} onArchived={() => {}} />,
    )
    try {
      expect(buttonLabelled(container, "Agent will send").disabled).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test("a source without a reply target and without a chat stays disabled", async () => {
    setMcpSources([mcpSource(null)])
    useInboxStore.getState().setReplyDraft("t1", "hello")
    const { container, cleanup } = await renderClientMarkup(<InboxReplyComposer thread={mcpThread()} onArchived={() => {}} />)
    try {
      expect(container.querySelector("textarea")?.disabled).toBe(true)
      expect(buttonLabelled(container, "Send").disabled).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("Enter sends the reply and Shift+Enter or Enter while composing does not", async () => {
    setMcpSources([mcpSource(REPLY_TARGET)])
    useInboxStore.getState().setReplyDraft("t1", "hello")
    const { socket, sent } = recordingSocket()
    const { container, cleanup } = await renderClientMarkup(
      <KannaSocketProvider socket={socket}>
        <InboxReplyComposer thread={mcpThread()} onArchived={() => {}} />
      </KannaSocketProvider>,
    )
    try {
      const textarea = container.querySelector("textarea")
      if (!textarea) throw new Error("no textarea")
      await pressEnter(textarea, { shiftKey: true })
      await pressEnter(textarea, { isComposing: true })
      await pressEnter(textarea, { keyCode: 229 })
      expect(sentCommands(sent)).toEqual([])
      await pressEnter(textarea)
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the reply command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.reply", threadId: "t1", text: "hello" }])
    } finally {
      await cleanup()
      socket.dispose()
    }
  })
})
