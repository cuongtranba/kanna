import { describe, expect, test } from "bun:test"
import { useChatStateStore } from "../stores/chatStateStore"
import { __testing } from "./useKannaState"

const { acquireChatSubscription, hasLiveSubscriptionForChat } = __testing

const seed = (chatId: string) => {
  useChatStateStore.getState().setChatReady(chatId, true)
  expect(useChatStateStore.getState().chats[chatId]).toBeDefined()
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("chat state release", () => {
  test("frees the slice when the last subscription for a chat is released", async () => {
    const chatId = "chat-release-1"
    seed(chatId)
    const release = acquireChatSubscription(`${chatId}:0`, () => () => {})

    release()
    await flushMicrotasks()

    expect(useChatStateStore.getState().chats[chatId]).toBeUndefined()
  })

  test("keeps the slice while a second tab still shows the same chat", async () => {
    const chatId = "chat-release-2"
    seed(chatId)
    const tabA = acquireChatSubscription(`${chatId}:0`, () => () => {})
    const tabB = acquireChatSubscription(`${chatId}:0`, () => () => {})

    tabA()
    await flushMicrotasks()
    expect(useChatStateStore.getState().chats[chatId]).toBeDefined()

    tabB()
    await flushMicrotasks()
    expect(useChatStateStore.getState().chats[chatId]).toBeUndefined()
  })

  test("a resync does NOT wipe the chat it is resubscribing", async () => {
    const chatId = "chat-release-3"
    seed(chatId)
    const oldNonce = acquireChatSubscription(`${chatId}:0`, () => () => {})

    oldNonce()
    const newNonce = acquireChatSubscription(`${chatId}:1`, () => () => {})
    await flushMicrotasks()

    expect(useChatStateStore.getState().chats[chatId]).toBeDefined()
    expect(hasLiveSubscriptionForChat(chatId)).toBe(true)

    newNonce()
    await flushMicrotasks()
    expect(useChatStateStore.getState().chats[chatId]).toBeUndefined()
  })

  test("releasing one chat leaves other chats untouched", async () => {
    const kept = "chat-release-keep"
    const dropped = "chat-release-drop"
    seed(kept)
    seed(dropped)
    const keptSub = acquireChatSubscription(`${kept}:0`, () => () => {})
    const droppedSub = acquireChatSubscription(`${dropped}:0`, () => () => {})

    droppedSub()
    await flushMicrotasks()

    expect(useChatStateStore.getState().chats[dropped]).toBeUndefined()
    expect(useChatStateStore.getState().chats[kept]).toBeDefined()
    keptSub()
  })

  test("a chat id containing colons still resolves to the right chat", async () => {
    const chatId = "weird:chat:id"
    seed(chatId)
    const release = acquireChatSubscription(`${chatId}:7`, () => () => {})
    expect(hasLiveSubscriptionForChat(chatId)).toBe(true)

    release()
    await flushMicrotasks()
    expect(useChatStateStore.getState().chats[chatId]).toBeUndefined()
  })

  test("double release is a no-op and cannot drop a re-acquired chat", async () => {
    const chatId = "chat-release-double"
    seed(chatId)
    const release = acquireChatSubscription(`${chatId}:0`, () => () => {})
    release()
    await flushMicrotasks()

    seed(chatId)
    const reacquired = acquireChatSubscription(`${chatId}:0`, () => () => {})
    release()
    await flushMicrotasks()

    expect(useChatStateStore.getState().chats[chatId]).toBeDefined()
    reacquired()
  })
})
