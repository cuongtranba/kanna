import { describe, expect, test } from "vite-plus/test"
import type { InboxActivityItem, InboxDraft, InboxThread } from "../../shared/inbox/types"
import { ASK_NEEDS_CHAT_REASON, draftChipLabel, fencedJson, formatUnreadBadge, inboxAskBlockedReason, inboxReplyMode, itemStateDisplay, reportSummaryText, subjectLabel, threadPreview, threadStateDisplay, verdictDisplay } from "./inboxPresentation"

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: "t",
    sourceKind: "webhook",
    sourceId: "h",
    sourceName: "CI",
    threadKey: "k",
    sender: "ada",
    messages: [],
    outbound: [],
    drafts: [],
    state: "new",
    unread: true,
    lastMessageAt: 1,
    replyCount: 0,
    ...overrides,
  }
}

function item(overrides: Partial<InboxActivityItem>): InboxActivityItem {
  return {
    id: "i",
    ts: 1,
    subject: "kanna.turn.finished",
    source: { kind: "store", log: "turns" },
    title: "Turn finished",
    preview: "",
    payload: {},
    attention: false,
    unread: false,
    ...overrides,
  }
}

describe("threadStateDisplay", () => {
  test("shows the agent reading while a handler is pending", () => {
    expect(threadStateDisplay(thread({ pendingScheduleId: "s1" }))).toEqual({ tone: "active", label: "Agent reading" })
  })

  test("a reported thread with a pending ask shows the agent reading again", () => {
    const reported = thread({
      state: "needs_you",
      pendingScheduleId: "inbox-instruct-t-1",
      report: { verdict: "needs_you", summary: "Pay it", at: 1, chatId: "c1" },
    })
    expect(threadStateDisplay(reported)).toEqual({ tone: "active", label: "Agent reading" })
  })

  test("needs you and new threads are attention, everything settled is muted", () => {
    expect(threadStateDisplay(thread({ state: "needs_you" }))).toEqual({ tone: "attention", label: "Needs you" })
    expect(threadStateDisplay(thread({ state: "new" }))).toEqual({ tone: "attention", label: "Needs you" })
    expect(threadStateDisplay(thread({ state: "fyi" }))).toEqual({ tone: "muted", label: "FYI" })
    expect(threadStateDisplay(thread({ state: "replied" }))).toEqual({ tone: "muted", label: "Replied" })
  })
})

describe("itemStateDisplay", () => {
  test("a failed turn is destructive and a plain attention item is attention", () => {
    expect(itemStateDisplay(item({ subject: "kanna.turn.failed", attention: true }))).toEqual({ tone: "destructive", label: "Failed" })
    expect(itemStateDisplay(item({ subject: "kanna.cron.runOutcome", title: "Cron run failed", attention: true })).tone).toBe("destructive")
    expect(itemStateDisplay(item({ subject: "kanna.toolRequest.put", attention: true })).tone).toBe("attention")
    expect(itemStateDisplay(item({})).tone).toBe("muted")
  })
})

describe("subjectLabel and badge", () => {
  test("names the subject family and caps the unread badge", () => {
    expect(subjectLabel("kanna.cron.runOutcome")).toBe("Cron")
    expect(subjectLabel("kanna.weird.thing")).toBe("weird")
    expect(formatUnreadBadge(7)).toBe("7")
    expect(formatUnreadBadge(120)).toBe("99+")
  })
})

describe("fencedJson", () => {
  test("wraps pretty JSON in a fence longer than any backtick run inside the payload", () => {
    expect(fencedJson({ a: 1 })).toBe("```json\n{\n  \"a\": 1\n}\n```")
    expect(fencedJson({ code: "```x```" }).startsWith("````json")).toBe(true)
  })
})

describe("agent read wording", () => {
  test("names the verdict and substitutes text for an empty summary", () => {
    expect(verdictDisplay("handled")).toEqual({ tone: "muted", label: "Handled" })
    expect(reportSummaryText("  ")).toBe("The agent ended its turn without a summary.")
    expect(reportSummaryText("Pay it")).toBe("Pay it")
  })
})

describe("threadPreview", () => {
  const inbound = { id: "m", deliveryId: "d", ts: 100, payload: {}, preview: "are you there" }

  test("shows your reply when it is newer than the last message that arrived", () => {
    const replied = thread({ messages: [inbound], outbound: [{ id: "o", ts: 200, text: "yes", by: "you", status: "sent" }] })
    expect(threadPreview(replied)).toBe("You: yes")
  })

  test("goes back to the message that arrived once the sender writes again", () => {
    const answered = thread({
      messages: [inbound, { ...inbound, id: "m2", ts: 300, preview: "great" }],
      outbound: [{ id: "o", ts: 200, text: "yes", by: "you", status: "sent" }],
    })
    expect(threadPreview(answered)).toBe("great")
  })
})

describe("inboxReplyMode", () => {
  const source = {
    id: "src1",
    name: "Zalo",
    mode: "subscribe" as const,
    serverId: "srv",
    enabled: true,
    threadKeyPath: "t",
    senderPath: "s",
    textPath: "",
    handler: { mode: "notify" as const, template: "t", replyHint: "", pushEnabled: true },
    reply: { tool: "send", args: {}, resultIdPath: "" },
    resourceUris: [],
    itemsPath: "",
    itemKeyPath: null,
    resyncIntervalMs: null,
    createdAt: 1,
    updatedAt: 1,
  }

  test("a source with a reply target sends directly, even with no handler chat", () => {
    expect(inboxReplyMode(thread({ sourceKind: "mcp", sourceId: "src1" }), [source])).toBe("direct")
  })

  test("without a reply target the handler chat sends, and with neither there is no way to reply", () => {
    const noReply = { ...source, reply: null }
    expect(inboxReplyMode(thread({ sourceKind: "mcp", sourceId: "src1", chatId: "c1" }), [noReply])).toBe("agent")
    expect(inboxReplyMode(thread({ sourceKind: "mcp", sourceId: "src1" }), [noReply])).toBe("none")
    expect(inboxReplyMode(thread({ sourceKind: "webhook", sourceId: "src1" }), [source])).toBe("none")
  })
})

describe("inboxAskBlockedReason", () => {
  test("a thread without a handler chat explains that Ask agent needs a source that runs in a chat", () => {
    expect(inboxAskBlockedReason(thread({}))).toBe(ASK_NEEDS_CHAT_REASON)
    expect(ASK_NEEDS_CHAT_REASON).toContain("Run in chat or New chat")
  })

  test("a thread with a chat can be asked unless it is archived", () => {
    expect(inboxAskBlockedReason(thread({ chatId: "c1" }))).toBeNull()
    expect(inboxAskBlockedReason(thread({ chatId: "c1", state: "archived" }))).toBe("This thread is archived")
  })
})

describe("draftChipLabel", () => {
  const triage: InboxDraft = { id: "d", text: "t", at: 1, origin: "triage" }

  test("labels the origin, the quick prompt name or a shortened instruction", () => {
    expect(draftChipLabel(triage, 1)).toBe("v1 · triage")
    expect(draftChipLabel({ ...triage, origin: "ask", instruction: "Rewrite the draft shorter, keeping its meaning." }, 3)).toBe("v3 · ask: Shorter")
    expect(draftChipLabel({ ...triage, origin: "ask", instruction: "mention the invoice number and the due date" }, 2)).toBe("v2 · ask: mention the invoice numb…")
    expect(draftChipLabel({ ...triage, origin: "ask" }, 2)).toBe("v2 · ask")
  })
})
