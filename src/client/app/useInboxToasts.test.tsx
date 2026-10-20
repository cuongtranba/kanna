import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import type { InboxSnapshot, InboxThread, InboxThreadState } from "../../shared/inbox/types"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { useInboxStore } from "../stores/inboxStore"
import { MAX_INBOX_TOASTS, useInboxToasts, type InboxToastPort, type InboxToastRequest } from "./useInboxToasts"

function thread(id: string, state: InboxThreadState = "needs_you"): InboxThread {
  return {
    id,
    sourceKind: "webhook",
    sourceId: "h",
    sourceName: "CI",
    threadKey: id,
    sender: `sender-${id}`,
    messages: [],
    state,
    unread: true,
    lastMessageAt: 100,
    replyCount: 0,
  }
}

function snapshot(threads: InboxThread[]): InboxSnapshot {
  return { threads, items: [], unreadCount: threads.length, total: threads.length }
}

class RecordingPort implements InboxToastPort {
  shown: InboxToastRequest[] = []
  show(request: InboxToastRequest): void {
    this.shown.push(request)
  }
}

function Probe({ port }: { port: InboxToastPort }) {
  useInboxToasts(port)
  return null
}

async function mount(port: RecordingPort, path: string) {
  return renderClientMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Probe port={port} />
    </MemoryRouter>,
  )
}

async function receive(threads: InboxThread[]) {
  await act(async () => {
    useInboxStore.getState().applySnapshot(snapshot(threads))
  })
}

beforeEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

afterEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

describe("useInboxToasts", () => {
  test("stays quiet for the first snapshot and toasts a thread that later turns needs you", async () => {
    const port = new RecordingPort()
    const { cleanup } = await mount(port, "/")
    try {
      await receive([thread("a"), thread("b", "fyi")])
      expect(port.shown).toEqual([])
      await receive([thread("a"), thread("b")])
      expect(port.shown.map((request) => request.title)).toEqual(["sender-b needs you"])
      await receive([thread("a"), thread("b")])
      expect(port.shown).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  test("caps a burst at three toasts and summarises the rest", async () => {
    const port = new RecordingPort()
    const { cleanup } = await mount(port, "/")
    try {
      await receive([thread("a", "fyi")])
      const burst = ["a", "b", "c", "d", "e"].map((id) => thread(id))
      await receive(burst)
      expect(port.shown).toHaveLength(MAX_INBOX_TOASTS + 1)
      expect(port.shown[MAX_INBOX_TOASTS]?.title).toBe("and 2 more need you")
    } finally {
      await cleanup()
    }
  })

  test("does not toast while the inbox page is open", async () => {
    const port = new RecordingPort()
    const { cleanup } = await mount(port, "/inbox")
    try {
      await receive([thread("a", "fyi")])
      await receive([thread("a")])
      expect(port.shown).toEqual([])
    } finally {
      await cleanup()
    }
  })
})
