import type { ChatCommandDeps } from "./ws-router-chat"

type ChatTeardownScope = {
  store: Pick<ChatCommandDeps["store"], "deleteChat">
  agent: Pick<
    ChatCommandDeps["agent"],
    "cancel" | "listLiveSchedules" | "cancelAutoContinue" | "disarmCronJobsForChat" | "closeChat" | "toolCallbackService"
  >
} & Pick<ChatCommandDeps, "followedSessionRegistry" | "shares">

export async function deleteChatCascade(deps: ChatTeardownScope, chatId: string): Promise<void> {
  const { store, agent, followedSessionRegistry, shares } = deps
  await shares?.revokeSharesForChat(chatId)
  followedSessionRegistry?.stop(chatId, "chat_deleted")
  await agent.cancel(chatId)
  for (const scheduleId of agent.listLiveSchedules(chatId)) {
    await agent.cancelAutoContinue(chatId, scheduleId, "chat_deleted")
  }
  await agent.disarmCronJobsForChat(chatId)
  await agent.closeChat(chatId)
  if (agent.toolCallbackService) {
    await agent.toolCallbackService.cancelAllForChat(chatId, "chat_deleted")
  }
  await store.deleteChat(chatId)
}
