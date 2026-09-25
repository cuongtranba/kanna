import { useChatInputStore } from "../stores/chatInputStore"
import { useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { useDiffCommitStore } from "../stores/diffCommitStore"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"

export function forgetDeletedLocally(deleted: {
  chatIds: readonly string[]
  boardIds?: readonly string[]
  projectId?: string
}): void {
  useChatInputStore.getState().forgetChats(deleted.chatIds)
  useChatPreferencesStore.getState().forgetChats(deleted.chatIds)
  usePaneLayoutStore.getState().closeTabsFor({ chatIds: deleted.chatIds, boardIds: deleted.boardIds ?? [] })
  if (deleted.projectId) useDiffCommitStore.getState().clearProject(deleted.projectId)
}
