
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

function makeSocket(chatListeners: ChatListener[]) {
  return {
    start(): void { },
    dispose(): void { },
    subscribe(topic: SubscriptionTopic, listener: unknown): () => void {
      if (topic.type === "chat") chatListeners.push(listener as ChatListener)
      return () => { }
    },
    onStatus(_listener: (status: SocketStatus) => void): () => void {
      return () => { }
    },
    command(_command: unknown): Promise<unknown> {
      return Promise.resolve({})
    },
  } as unknown as KannaSocket
}

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

    expect(chatListeners.length).toBe(1)

    await act(async () => {
      chatListeners[0]!(chatSnapshotWithOlderHistory())
    })
    expect(selectChatSlice(useChatStateStore.getState(), CHAT_ID).historyCursor).toBe(OLDER_CURSOR)
    expect(selectChatSlice(useChatStateStore.getState(), CHAT_ID).hasOlderHistory).toBe(true)

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
