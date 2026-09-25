import { pendingActionKey, usePendingActionsStore } from "../../../stores/pendingActionsStore"

export type ChatRowAction = "chat.rename" | "chat.fork" | "chat.archive" | "chat.delete" | "chat.openInFinder"

export type ProjectAction =
  | "project.copyPath"
  | "project.openFinder"
  | "project.openEditor"
  | "project.setStar"
  | "project.remove"
  | "project.setInstructions"

const CHAT_ROW_ACTIONS: readonly ChatRowAction[] = ["chat.rename", "chat.fork", "chat.archive", "chat.delete", "chat.openInFinder"]

const PROJECT_ACTIONS: readonly ProjectAction[] = [
  "project.copyPath",
  "project.openFinder",
  "project.openEditor",
  "project.setStar",
  "project.remove",
  "project.setInstructions",
]

export const BULK_DELETE_CHATS_KEY = pendingActionKey("chat.delete", "bulk")
export const REORDER_PROJECT_GROUPS_KEY = pendingActionKey("sidebar.reorderProjectGroups")
export const STACK_PANEL_SAVE_KEY = pendingActionKey("stack.save")
export const IMPORT_ALL_SESSIONS_KEY = pendingActionKey("sessions.importClaude")
export const IMPORT_SESSION_IDS_KEY = pendingActionKey("sessions.importClaudeSession")
export const CREATE_PROJECT_KEY = pendingActionKey("project.create")

export function chatRowActionKey(action: ChatRowAction, chatId: string): string {
  return pendingActionKey(action, chatId)
}

export function projectActionKey(action: ProjectAction, projectId: string): string {
  return pendingActionKey(action, projectId)
}

export function createChatKey(projectId: string): string {
  return pendingActionKey("chat.create", projectId)
}

export function openProjectKey(localPath: string): string {
  return pendingActionKey("project.open", localPath)
}

export function removeStackKey(stackId: string): string {
  return pendingActionKey("stack.remove", stackId)
}

export function startStackChatKey(stackId: string): string {
  return pendingActionKey("stack.listWorktrees", stackId)
}

export function createStackChatKey(stackId: string): string {
  return pendingActionKey("chat.create", "stack", stackId)
}

export function useChatRowPending(chatId: string): boolean {
  return usePendingActionsStore((state) => CHAT_ROW_ACTIONS.some((action) => state.inFlight[chatRowActionKey(action, chatId)] === true))
}

export function useProjectPending(projectId: string): boolean {
  return usePendingActionsStore((state) => PROJECT_ACTIONS.some((action) => state.inFlight[projectActionKey(action, projectId)] === true))
}
