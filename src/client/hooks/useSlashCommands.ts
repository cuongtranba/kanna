import { useSlashCommandsStore } from "../stores/slashCommandsStore"
import type { SlashCommand } from "../../shared/types"

const EMPTY: SlashCommand[] = []

export function selectSlashCommands(
  state: { byProjectId: Record<string, SlashCommand[]> },
  projectId: string | null,
): SlashCommand[] {
  if (!projectId) return EMPTY
  return state.byProjectId[projectId] ?? EMPTY
}

export function useSlashCommands(projectId: string | null): SlashCommand[] {
  return useSlashCommandsStore((state) => selectSlashCommands(state, projectId))
}
