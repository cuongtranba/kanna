import { describe, test, expect } from "bun:test"
import { recoverQueuedMessages } from "./queued-message-recovery"

function makeDeps(opts: {
  chats?: string[]
  started?: string[]
  failOn?: string
}) {
  const started = opts.started ?? []
  return {
    started,
    listChatsWithQueuedMessages: () => opts.chats ?? [],
    maybeStartNextQueuedMessage: async (chatId: string) => {
      if (chatId === opts.failOn) throw new Error("spawn refused")
      started.push(chatId)
      return true
    },
  }
}

describe("recoverQueuedMessages", () => {
  test("restarts every chat left holding a queued message", async () => {
    const deps = makeDeps({ chats: ["chat-1", "chat-2"] })
    const recovered = await recoverQueuedMessages(deps)
    expect(deps.started).toEqual(["chat-1", "chat-2"])
    expect(recovered).toEqual(["chat-1", "chat-2"])
  })

  test("does nothing when no chat has a queued message", async () => {
    const deps = makeDeps({ chats: [] })
    expect(await recoverQueuedMessages(deps)).toEqual([])
    expect(deps.started).toEqual([])
  })

  test("reports only chats that actually started", async () => {
    const deps = makeDeps({ chats: ["chat-1"] })
    deps.maybeStartNextQueuedMessage = async () => false
    expect(await recoverQueuedMessages(deps)).toEqual([])
  })

  test("one failing chat does not abort the rest of boot", async () => {
    const deps = makeDeps({ chats: ["chat-1", "chat-2", "chat-3"], failOn: "chat-2" })
    const recovered = await recoverQueuedMessages(deps)
    expect(deps.started).toEqual(["chat-1", "chat-3"])
    expect(recovered).toEqual(["chat-1", "chat-3"])
  })
})
