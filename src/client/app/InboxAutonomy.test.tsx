import { afterEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { MCP_SOURCE_AUTONOMY_DEFAULTS, type McpSourceAutonomy } from "../../shared/inbox/autonomy"
import type { InboxOutboundMessage, InboxProposal, InboxThread } from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"
import { defaultAppSettingsSnapshot } from "../../server/app-settings"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { waitFor } from "../lib/testing/waitFor"
import type { WebSocketLike, WebSocketPort } from "../ports/webSocketPort"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useInboxStore } from "../stores/inboxStore"
import { InboxFilterBar } from "./InboxFilterBar"
import { InboxThreadDetail } from "./InboxThreadDetail"
import { KannaSocketProvider } from "./KannaSocketProvider"
import { KannaSocket } from "./socket"

const REPLY_TARGET: McpSource["reply"] = { tool: "send", args: { text: "{{reply.text}}" }, resultIdPath: "" }
const HOUR_MS = 60 * 60 * 1000

function source(overrides: { reply?: McpSource["reply"]; provider?: "claude" | "codex"; autonomy?: Partial<McpSourceAutonomy> } = {}): McpSource {
  return {
    id: "src1",
    name: "Zalo",
    mode: "subscribe",
    serverId: "srv",
    enabled: true,
    threadKeyPath: "threadId",
    senderPath: "senderName",
    textPath: "",
    handler: {
      mode: "notify",
      template: "t",
      replyHint: "",
      pushEnabled: true,
      ...(overrides.provider === undefined ? {} : { provider: overrides.provider, model: "m" }),
    },
    reply: "reply" in overrides ? (overrides.reply ?? null) : REPLY_TARGET,
    resourceUris: ["zalo://inbox"],
    itemsPath: "messages",
    itemKeyPath: "id",
    resyncIntervalMs: null,
    autonomy: { ...MCP_SOURCE_AUTONOMY_DEFAULTS, ...overrides.autonomy },
    createdAt: 1,
    updatedAt: 1,
  }
}

function setSources(sources: McpSource[]) {
  useAppSettingsStore.getState().setFromServer({ ...defaultAppSettingsSnapshot(), mcpSources: sources })
}

function proposal(overrides: Partial<InboxProposal> = {}): InboxProposal {
  return { id: "p1", text: "On my way", confidence: 0.92, reason: "They asked where I am", at: 1, status: "open", ...overrides }
}

function outbound(overrides: Partial<InboxOutboundMessage>): InboxOutboundMessage {
  return { id: "o1", ts: 2000, text: "on my way", by: "you", status: "sent", ...overrides }
}

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: "t1",
    sourceKind: "mcp",
    sourceId: "src1",
    sourceName: "Zalo",
    threadKey: "alice",
    sender: "ada",
    messages: [{ id: "m1", deliveryId: "d1", ts: 1000, payload: { text: "where are you" }, preview: "where are you" }],
    outbound: [],
    drafts: [],
    chatId: "c1",
    state: "needs_you",
    unread: false,
    lastMessageAt: 1000,
    replyCount: 0,
    ...overrides,
  }
}

function recordingSocket() {
  const sent: string[] = []
  const ws: WebSocketLike = { readyState: 1, send: (data) => { sent.push(data) }, close: () => {}, addEventListener: () => {} }
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
        <InboxThreadDetail thread={target} prevId={null} nextId={null} onOpenThread={() => {}} onBack={() => {}} onArchived={() => {}} />
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

function hasButton(container: HTMLElement, label: string): boolean {
  return [...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === label)
}

function click(button: HTMLButtonElement) {
  return act(async () => {
    button.click()
  })
}

function autonomySelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector("select[aria-label='Autonomy']")
  if (!(select instanceof HTMLSelectElement)) throw new Error("No autonomy select")
  return select
}

function optionState(container: HTMLElement): Record<string, boolean> {
  return Object.fromEntries([...autonomySelect(container).options].map((option) => [option.value, option.disabled]))
}

function choose(select: HTMLSelectElement, value: string) {
  return act(async () => {
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

const APP_SETTINGS_INITIAL = useAppSettingsStore.getInitialState()

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
  useAppSettingsStore.setState(APP_SETTINGS_INITIAL)
})

describe("open proposal card", () => {
  test("Send approves the proposal", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ proposal: proposal() }))
    try {
      expect(container.textContent).toContain("On my way")
      expect(container.textContent).toContain("Confidence 92%")
      await click(buttonLabelled(container, "Send"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the approve command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.approveProposal", threadId: "t1", proposalId: "p1" }])
    } finally {
      await cleanup()
    }
  })

  test("Reject rejects the proposal", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ proposal: proposal() }))
    try {
      await click(buttonLabelled(container, "Reject"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the reject command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.rejectProposal", threadId: "t1", proposalId: "p1" }])
    } finally {
      await cleanup()
    }
  })

  test("Edit puts the proposal text in the composer and sends nothing", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ proposal: proposal() }))
    try {
      await click(buttonLabelled(container, "Edit"))
      const textarea = container.querySelector("textarea[aria-label='Reply to the sender']")
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("No composer")
      expect(textarea.value).toBe("On my way")
      expect(sentCommands(sent)).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("says why a guardrail turned Auto into a card", async () => {
    setSources([source()])
    const { container, cleanup } = await mount(thread({ proposal: proposal({ blockedBy: "Quiet hours are active" }) }))
    try {
      expect(container.textContent).toContain("Quiet hours are active")
    } finally {
      await cleanup()
    }
  })
})

describe("scheduled proposal card", () => {
  test("counts down to the send and Undo cancels it", async () => {
    setSources([source()])
    const scheduled = proposal({ status: "scheduled", scheduledFor: Date.now() + 24_000 })
    const { container, sent, cleanup } = await mount(thread({ proposal: scheduled }))
    try {
      expect(container.textContent).toMatch(/Sending in 0:2\d/)
      expect(hasButton(container, "Reject")).toBe(false)
      await click(buttonLabelled(container, "Undo"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the cancel command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.cancelProposal", threadId: "t1", proposalId: "p1" }])
    } finally {
      await cleanup()
    }
  })
})

describe("agent paused chip", () => {
  test("shows while the pause lasts and Resume hands the thread back", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ agentPausedUntil: Date.now() + HOUR_MS }))
    try {
      expect(container.textContent).toContain("Agent paused")
      await click(buttonLabelled(container, "Resume"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the resume command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.resumeAgent", threadId: "t1" }])
    } finally {
      await cleanup()
    }
  })

  test("is gone once the pause has run out", async () => {
    setSources([source()])
    const { container, cleanup } = await mount(thread({ agentPausedUntil: Date.now() - 1000 }))
    try {
      expect(container.textContent).not.toContain("Agent paused")
    } finally {
      await cleanup()
    }
  })
})

describe("autonomy dropdown", () => {
  test("offers the source default and every level, with Auto enabled for a Claude handler with a reply tool", async () => {
    setSources([source({ provider: "claude", autonomy: { level: "approve" } })])
    const { container, cleanup } = await mount(thread())
    try {
      expect([...autonomySelect(container).options].map((option) => option.textContent)).toEqual([
        "Source default (Approve)",
        "Off",
        "Suggest",
        "Approve",
        "Auto",
      ])
      expect(optionState(container)).toEqual({ default: false, off: false, suggest: false, approve: false, auto: false })
    } finally {
      await cleanup()
    }
  })

  test("disables Auto and says why when the handler is Codex", async () => {
    setSources([source({ provider: "codex" })])
    const { container, cleanup } = await mount(thread())
    try {
      expect(optionState(container)).toMatchObject({ approve: false, auto: true })
      expect(container.textContent).toContain("Auto needs a Claude handler")
    } finally {
      await cleanup()
    }
  })

  test("disables Approve and Auto when the source has no reply target", async () => {
    setSources([source({ reply: null })])
    const { container, cleanup } = await mount(thread())
    try {
      expect(optionState(container)).toMatchObject({ suggest: false, approve: true, auto: true })
      expect(container.textContent).toContain("need a reply target")
    } finally {
      await cleanup()
    }
  })

  test("choosing a level overrides the thread", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ autonomy: "off" }))
    try {
      expect(autonomySelect(container).value).toBe("off")
      await choose(autonomySelect(container), "approve")
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the override command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.setThreadAutonomy", threadId: "t1", level: "approve" }])
    } finally {
      await cleanup()
    }
  })

  test("choosing the source default clears the override", async () => {
    setSources([source()])
    const { container, sent, cleanup } = await mount(thread({ autonomy: "off" }))
    try {
      await choose(autonomySelect(container), "default")
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the clear command")
      expect(sentCommands(sent)).toEqual([{ type: "inbox.setThreadAutonomy", threadId: "t1", level: null }])
    } finally {
      await cleanup()
    }
  })

  test("a webhook thread has no autonomy controls", async () => {
    setSources([source()])
    const { container, cleanup } = await mount(thread({ sourceKind: "webhook", sourceId: "h1" }))
    try {
      expect(container.querySelector("select[aria-label='Autonomy']")).toBeNull()
    } finally {
      await cleanup()
    }
  })
})

describe("allow auto for this contact", () => {
  test("adds the thread key to the source allowlist when Auto would apply to a contact not on it", async () => {
    setSources([source({ autonomy: { level: "auto", allowlist: ["bob"] } })])
    const { container, sent, cleanup } = await mount(thread())
    try {
      await click(buttonLabelled(container, "Allow auto for this contact"))
      await waitFor(() => sentCommands(sent).length === 1, 2000, "the settings patch")
      expect(sentCommands(sent)).toEqual([
        {
          type: "settings.writeAppSettingsPatch",
          patch: { mcpSources: { update: { id: "src1", patch: { autonomy: { allowlist: ["bob", "alice"] } } } } },
        },
      ])
    } finally {
      await cleanup()
    }
  })

  test("is not offered to a contact already on the allowlist or when Auto is not in effect", async () => {
    setSources([source({ autonomy: { level: "auto", allowlist: ["alice"] } })])
    const allowed = await mount(thread())
    try {
      expect(hasButton(allowed.container, "Allow auto for this contact")).toBe(false)
    } finally {
      await allowed.cleanup()
    }
    setSources([source({ autonomy: { level: "approve" } })])
    const approving = await mount(thread())
    try {
      expect(hasButton(approving.container, "Allow auto for this contact")).toBe(false)
    } finally {
      await approving.cleanup()
    }
  })
})

describe("outbound labels", () => {
  test("labels what you, an approval and the agent sent", async () => {
    setSources([source()])
    const provenance = { id: "p1", confidence: 0.9, reason: "They asked" }
    const { container, cleanup } = await mount(
      thread({
        outbound: [
          outbound({ id: "o1", ts: 2000, by: "you", text: "typed by hand" }),
          outbound({ id: "o2", ts: 3000, by: "approved", text: "approved text", proposal: provenance }),
          outbound({ id: "o3", ts: 4000, by: "agent", text: "agent text", proposal: provenance }),
        ],
      }),
    )
    try {
      const rows = [...container.querySelectorAll("section[aria-label='Messages'] li")].map((row) => row.textContent ?? "")
      expect(rows[1]).toMatch(/^You\d{2}:\d{2}typed by hand/)
      expect(rows[2]).toMatch(/^You · approved\d{2}:\d{2}approved text/)
      expect(rows[3]).toMatch(/^Agent · auto\d{2}:\d{2}agent text/)
    } finally {
      await cleanup()
    }
  })

  test("hovering an agent label shows its confidence and reason in a tooltip", async () => {
    setSources([source()])
    const provenance = { id: "p1", confidence: 0.9, reason: "They asked where I am" }
    const { container, cleanup } = await mount(
      thread({ outbound: [outbound({ by: "agent", text: "agent text", proposal: provenance })] }),
    )
    try {
      const label = [...container.querySelectorAll("span")].find((span) => span.textContent === "Agent · auto")
      if (label === undefined) throw new Error("No agent label")
      expect(label.hasAttribute("title")).toBe(false)
      await act(async () => {
        label.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }))
      })
      await waitFor(() => document.body.textContent?.includes("Confidence 90% · They asked where I am") === true, 2000, "the tooltip")
    } finally {
      await cleanup()
    }
  })
})

describe("Sent by agent filter chip", () => {
  test("toggles the filter that keeps only threads the agent sent on", async () => {
    const rendered = await renderClientMarkup(<InboxFilterBar filter={{}} targets={{ chats: [], projects: [] }} />)
    try {
      await click(buttonLabelled(rendered.container, "Sent by agent"))
      expect(useInboxStore.getState().filter.sentByAgent).toBe(true)
      useInboxStore.getState().toggleSentByAgent()
      expect(useInboxStore.getState().filter.sentByAgent).toBeUndefined()
    } finally {
      await rendered.cleanup()
    }
  })
})
