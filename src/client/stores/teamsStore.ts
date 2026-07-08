import { create } from "zustand"
import type { TeamTaskSummary } from "../../shared/types"

const EMPTY: TeamTaskSummary[] = []

interface TeamsState {
  byChat: Record<string, TeamTaskSummary[]>
  setTasks(chatId: string, tasks: TeamTaskSummary[]): void
}

export const useTeamsStore = create<TeamsState>()((set) => ({
  byChat: {},
  setTasks: (chatId, tasks) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: tasks } })),
}))

export function selectTasks(chatId: string) {
  return (s: TeamsState): TeamTaskSummary[] => s.byChat[chatId] ?? EMPTY
}
