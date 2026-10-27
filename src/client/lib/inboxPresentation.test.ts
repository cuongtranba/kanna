import { describe, expect, test } from "vite-plus/test"
import type { InboxActivityItem, InboxThread } from "../../shared/inbox/types"
import { fencedJson, formatUnreadBadge, itemStateDisplay, reportSummaryText, subjectLabel, threadStateDisplay, verdictDisplay } from "./inboxPresentation"

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: "t",
    sourceKind: "webhook",
    sourceId: "h",
    sourceName: "CI",
    threadKey: "k",
    sender: "ada",
    messages: [],
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
  test("shows the agent reading while a handler is pending and has not reported", () => {
    expect(threadStateDisplay(thread({ pendingScheduleId: "s1" }))).toEqual({ tone: "active", label: "Agent reading" })
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
