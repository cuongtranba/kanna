import { expect, test } from "vite-plus/test"
import { AgentCoordinator } from "./agent-coordinator"
import { EventStore } from "./event-store"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"
import { AsyncEventQueue } from "./test-helpers/async-event-queue"
import { waitFor } from "./test-helpers/wait-for"

class FlakyDiskStorage extends InMemoryStorageBackend {
  diskGone = false

  override async appendText(path: string, content: string): Promise<void> {
    if (this.diskGone) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" })
    await super.appendText(path, content)
  }
}

test("a disk failure while a closed Claude session settles its turn is contained, not an unhandled rejection", async () => {
  const storage = new FlakyDiskStorage()
  const store = new EventStore("/virtual-detached-run", storage)
  await store.initialize()
  const project = await store.openProject("/tmp/detached-run-proj")
  const chat = await store.createChat(project.id)
  const events = new AsyncEventQueue<never>()
  const coordinator = new AgentCoordinator({
    store,
    onStateChange: () => {},
    startClaudeSession: async () => ({
      provider: "claude" as const,
      stream: events,
      getAccountInfo: async () => null,
      interrupt: async () => {},
      close: () => events.close(),
      closed: Promise.resolve(),
      setModel: async () => {},
      setPermissionMode: async () => {},
      sendPrompt: async () => {},
    }),
  })

  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  process.on("unhandledRejection", onUnhandled)
  try {
    await coordinator.send({
      type: "chat.send",
      chatId: chat.id,
      content: "hello",
      model: "claude-opus-4-5",
      provider: "claude",
    })
    await waitFor(() => coordinator.hasActiveTurn(chat.id))

    storage.diskGone = true
    await coordinator.dispose()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(unhandled).toEqual([])
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
})
