import { describe, expect, test } from "bun:test"
import { deleteChatCascade } from "./chat-teardown"

function recordingDeps(calls: string[], options: { withShares: boolean }): Parameters<typeof deleteChatCascade>[0] {
  return {
    store: { deleteChat: async (chatId) => { calls.push(`store.deleteChat:${chatId}`) } },
    agent: {
      cancel: async (chatId) => { calls.push(`agent.cancel:${chatId}`) },
      cancelAutoContinue: async (chatId, scheduleId) => { calls.push(`agent.cancelAutoContinue:${chatId}:${scheduleId}`) },
      listLiveSchedules: () => ["schedule-1"],
      disarmCronJobsForChat: async (chatId) => { calls.push(`agent.disarmCronJobsForChat:${chatId}`) },
      closeChat: async (chatId) => { calls.push(`agent.closeChat:${chatId}`) },
      toolCallbackService: {
        cancelAllForChat: async (chatId) => { calls.push(`tools.cancelAllForChat:${chatId}`) },
        answer: async () => {},
      },
    },
    followedSessionRegistry: { stop: (chatId) => { calls.push(`followed.stop:${chatId}`) } },
    ...(options.withShares
      ? { shares: { revokeSharesForChat: async (chatId: string) => { calls.push(`shares.revoke:${chatId}`) } } }
      : {}),
  }
}

describe("deleteChatCascade", () => {
  test("deleting one chat revokes its share links before the chat is removed", async () => {
    const calls: string[] = []
    await deleteChatCascade(recordingDeps(calls, { withShares: true }), "chat-1")

    expect(calls).toEqual([
      "shares.revoke:chat-1",
      "followed.stop:chat-1",
      "agent.cancel:chat-1",
      "agent.cancelAutoContinue:chat-1:schedule-1",
      "agent.disarmCronJobsForChat:chat-1",
      "agent.closeChat:chat-1",
      "tools.cancelAllForChat:chat-1",
      "store.deleteChat:chat-1",
    ])
  })

  test("tears the chat down when no share service is wired", async () => {
    const calls: string[] = []
    await deleteChatCascade(recordingDeps(calls, { withShares: false }), "chat-2")

    expect(calls.at(-1)).toBe("store.deleteChat:chat-2")
    expect(calls.some((call) => call.startsWith("shares."))).toBe(false)
  })
})
