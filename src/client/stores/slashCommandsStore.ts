import { create } from "zustand"
import type { SlashCommand } from "../../shared/types"
import { omitKey } from "../lib/recordOps"

interface SlashCommandsState {
  byProjectId: Record<string, SlashCommand[]>
  setForProject: (projectId: string, commands: SlashCommand[]) => void
  clear: (projectId: string) => void
}

export const useSlashCommandsStore = create<SlashCommandsState>()((set) => ({
  byProjectId: {},
  setForProject: (projectId, commands) =>
    set((state) => ({ byProjectId: { ...state.byProjectId, [projectId]: commands } })),
  clear: (projectId) =>
    set((state) => {
      if (!(projectId in state.byProjectId)) return state
      return { byProjectId: omitKey(state.byProjectId, projectId) }
    }),
}))
