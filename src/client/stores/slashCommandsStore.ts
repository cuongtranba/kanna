import { create } from "zustand"
import type { SlashCommand } from "../../shared/types"

/**
 * The composer `/` picker's catalog, keyed by project.
 *
 * Keyed by project, not chat, because the catalog is derived from the project's
 * cwd: every chat in a project shares one list, so opening a new chat needs no
 * fetch of its own. There is deliberately no loading flag — the server builds
 * the list synchronously and ships it in the first snapshot frame.
 */
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
      const { [projectId]: _dropped, ...byProjectId } = state.byProjectId
      return { byProjectId }
    }),
}))
