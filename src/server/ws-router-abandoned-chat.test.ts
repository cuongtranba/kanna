import { expect, test, vi } from "vite-plus/test"
import { DEFAULT_KEYBINDINGS } from "../shared/types"
import { createWsRouter } from "./ws-router"
import { createTestEventStore } from "./storage/test-helpers"

const PUSH_MANAGER_STUB = {
  initialize: async () => {},
  observeStatuses: async () => {},
  getConfigSnapshot: () => ({
    vapidPublicKey: "test-key",
    preferences: { globalEnabled: true, mutedProjectPaths: [] },
    devices: [],
  }),
  setFocusedChat: () => {},
  clearFocus: () => {},
} as never

class FakeWebSocket {
  readonly sent: unknown[] = []
  readonly data = {
    subscriptions: new Map(),
    protectedDraftChatIds: new Set<string>(),
  }

  send(message: string) {
    this.sent.push(JSON.parse(message))
  }
}

async function setup() {
  const store = createTestEventStore(`/virtual-abandoned-chat-${crypto.randomUUID()}`)
  await store.initialize()
  const project = await store.openProject("/tmp/project")
  const chat = await store.createChat(project.id)
  const scheduledChecks: Array<() => void> = []
  const router = createWsRouter({
    store,
    agent: { getActiveStatuses: () => new Map(), getDrainingChatIds: () => new Set(), getWaitStartedAtByChatId: () => new Map() } as never,
    terminals: { getSnapshot: () => null, onEvent: () => () => {} } as never,
    keybindings: {
      getSnapshot: () => ({ bindings: DEFAULT_KEYBINDINGS, warning: null, filePathDisplay: "~/.kanna/keybindings.json" }),
      onChange: () => () => {},
    } as never,
    refreshDiscovery: async () => [],
    getDiscoveredProjects: () => [],
    machineDisplayName: "Local Machine",
    updateManager: null,
    pushManager: PUSH_MANAGER_STUB,
    scheduleChatCheck: (run) => {
      scheduledChecks.push(run)
      return () => {}
    },
  })
  const open = (subscriptionId: string) => {
    const ws = new FakeWebSocket()
    router.handleOpen(ws as never)
    const send = (envelope: object) => router.handleMessage(ws as never, JSON.stringify({ v: 1, ...envelope }))
    return {
      subscribe: () => send({ type: "subscribe", id: subscriptionId, topic: { type: "chat", chatId: chat.id } }),
      unsubscribe: () => send({ type: "unsubscribe", id: subscriptionId }),
    }
  }
  return { store, chat, router, scheduledChecks, open }
}

test("deletes an empty chat once the user navigates away without typing", async () => {
  const { store, chat, router, scheduledChecks, open } = await setup()
  const viewer = open("chat-sub")
  await viewer.subscribe()
  await viewer.unsubscribe()

  expect(store.getChat(chat.id)?.id).toBe(chat.id)
  expect(scheduledChecks).toHaveLength(1)
  scheduledChecks[0]()

  await vi.waitFor(() => expect(store.getChat(chat.id)).toBeNull())
  router.dispose()
})

test("keeps an empty chat that another tab is still viewing", async () => {
  const { store, chat, router, scheduledChecks, open } = await setup()
  const leaving = open("chat-sub-a")
  const staying = open("chat-sub-b")
  await leaving.subscribe()
  await staying.subscribe()
  await leaving.unsubscribe()

  scheduledChecks[0]()
  await new Promise((resolve) => setImmediate(resolve))

  expect(store.getChat(chat.id)?.id).toBe(chat.id)
  router.dispose()
})
