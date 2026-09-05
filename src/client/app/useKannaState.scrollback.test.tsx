/**
 * Scrollback survives a second consumer mounting for the same chat.
 *
 * `history.olderCursor` reaches the client on ONE event: the chat snapshot, via
 * `adoptServerHistory`. Chat subscriptions are refcount-shared
 * (`acquireChatSubscription`), so that snapshot is delivered only to the
 * consumer that CREATED the subscription — the route-level `useKannaState` in
 * App.tsx and every `ChatTabRoot` for the same chat just join it and are never
 * called back. Anything that clears the slice after that point is unrecoverable:
 * `loadOlderHistory` early-returns without a cursor, so scrolling to the top
 * shows no loader and fetches nothing, for the rest of the page's life.
 *
 * That is what a "reset scrollback on chat change" effect did — it cleared the
 * slice of the chat being ENTERED, on every consumer's mount.
 */

import { describe, expect, test } from "bun:test"
import { MemoryRouter } from "react-router-dom"
import { act } from "react"
import { AppDialogProvider } from "../components/ui/app-dialog"
import { AppGlobalProvider } from "./AppGlobalProvider"
import { useKannaState } from "./useKannaState"
import { selectChatSlice, useChatStateStore } from "../stores/chatStateStore"
import type { KannaSocket, SocketStatus } from "./socket"
import type { ChatSnapshot } from "../../shared/types"
import type { SubscriptionTopic } from "../../shared/protocol"
import { makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"

const CHAT_ID = "chat-scrollback"
const OLDER_CURSOR = "byte:3745918"

type ChatListener = (snapshot: ChatSnapshot | null) => void

/**
 * `KannaSocket` is a class with private fields, so a structural literal needs a
 * cast — the precedent set by `AppGlobalProvider.test.tsx`.
 */
function makeSocket(chatListeners: ChatListener[]) {
  return {
    start(): void { /* no-op — don't connect */ },
    dispose(): void { /* no-op */ },
    subscribe(topic: SubscriptionTopic, listener: unknown): () => void {
      if (topic.type === "chat") chatListeners.push(listener as ChatListener)
      return () => { /* no-op */ }
    },
    onStatus(_listener: (status: SocketStatus) => void): () => void {
      return () => { /* no-op */ }
    },
    command(_command: unknown): Promise<unknown> {
      return Promise.resolve({})
    },
  } as unknown as KannaSocket
}

/** The narrow slice of a snapshot this path reads; the rest is untouched here. */
function chatSnapshotWithOlderHistory(): ChatSnapshot {
  return {
    runtime: { chatId: CHAT_ID, projectId: "project-1" },
    messages: [],
    history: { hasOlder: true, olderCursor: OLDER_CURSOR, recentLimit: 200 },
  } as unknown as ChatSnapshot
}

function Consumer() {
  useKannaState(CHAT_ID)
  return null
}

function harness(socket: KannaSocket) {
  return (
    <MemoryRouter>
      <AppDialogProvider ports={{ timer: makeFakeTimerPort() }}>
        <AppGlobalProvider ports={{ socket }}>
          <Consumer />
        </AppGlobalProvider>
      </AppDialogProvider>
    </MemoryRouter>
  )
}

describe("useKannaState scrollback", () => {
  test("a second consumer for the same chat does not wipe the adopted cursor", async () => {
    useChatStateStore.setState({ chats: {} })

    const chatListeners: ChatListener[] = []
    const first = await renderForLoopCheck(harness(makeSocket(chatListeners)))
    expect(first.thrown).toBeNull()

    // Exactly one subscription exists for the chat, so exactly one consumer is
    // ever handed the snapshot — the invariant the reset effect fell foul of.
    expect(chatListeners.length).toBe(1)

    await act(async () => {
      chatListeners[0]!(chatSnapshotWithOlderHistory())
    })
    expect(selectChatSlice(useChatStateStore.getState(), CHAT_ID).historyCursor).toBe(OLDER_CURSOR)
    expect(selectChatSlice(useChatStateStore.getState(), CHAT_ID).hasOlderHistory).toBe(true)

    // A second `useKannaState` for the same chat — the route-level hook and each
    // ChatTabRoot both do this — joins the live subscription and is NOT re-sent
    // the snapshot, so whatever it does on mount is the last word on the slice.
    const second = await renderForLoopCheck(harness(makeSocket(chatListeners)))
    expect(second.thrown).toBeNull()
    expect(chatListeners.length).toBe(1)

    const slice = selectChatSlice(useChatStateStore.getState(), CHAT_ID)
    expect(slice.historyCursor).toBe(OLDER_CURSOR)
    expect(slice.hasOlderHistory).toBe(true)

    await second.cleanup()
    await first.cleanup()
  })
})
