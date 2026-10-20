import { afterEach, describe, expect, test } from "bun:test"
import type { InboxThread } from "../../shared/inbox/types"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { useInboxStore } from "../stores/inboxStore"
import { InboxReplyComposer } from "./InboxReplyComposer"

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: "t1",
    sourceKind: "webhook",
    sourceId: "h1",
    sourceName: "CI",
    threadKey: "k",
    sender: "ada",
    messages: [],
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

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

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

  test("seeds the textarea with the agent's draft and enables sending once a chat handles the thread", async () => {
    const withDraft = thread({
      chatId: "c1",
      report: { verdict: "needs_you", summary: "Pay it", draftReply: "On it, thanks", at: 1, chatId: "c1" },
    })
    const { container, cleanup } = await renderClientMarkup(<InboxReplyComposer thread={withDraft} onArchived={() => {}} />)
    try {
      expect(container.querySelector("textarea")?.value).toBe("On it, thanks")
      expect(buttonLabelled(container, "Send").disabled).toBe(false)
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
      expect(buttonLabelled(container, "Send").disabled).toBe(true)
    } finally {
      await cleanup()
    }
  })
})
