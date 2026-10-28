import { pendingActionKey } from "../../stores/pendingActionsStore"

export function projectOpenExternalKey(projectId: string | null): string {
  return pendingActionKey("system.openExternal", "project", projectId ?? "")
}

export function gitInitializeKey(projectId: string | null): string {
  return pendingActionKey("git.initialize", projectId ?? "")
}
