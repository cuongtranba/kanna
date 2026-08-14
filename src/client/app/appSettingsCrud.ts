import { useMemo } from "react"
import type { AppSettingsPatch } from "../../shared/types"
import type { KannaState } from "./useKannaState"

/** The branch shape every collection key of `AppSettingsPatch` shares. */
export interface AppSettingsCrudBranch<Input, Patch> {
  create?: Input
  update?: { id: string; patch: Patch }
  delete?: { id: string }
}

/**
 * Files the branch under its `AppSettingsPatch` key — the ONLY thing that
 * differs between the Settings CRUD sections. Declare it at module scope so the
 * reference stays stable across renders.
 */
export type AppSettingsPatchWrapper<Input, Patch> = (
  branch: AppSettingsCrudBranch<Input, Patch>,
) => AppSettingsPatch

export interface AppSettingsCrudHandlers<Input, Patch> {
  onCreate: (input: Input) => Promise<void>
  onUpdate: (id: string, patch: Patch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function useAppSettingsCrudHandlers<Input, Patch>(
  wrap: AppSettingsPatchWrapper<Input, Patch>,
  state: Pick<KannaState, "handleWriteAppSettings">,
): AppSettingsCrudHandlers<Input, Patch> {
  return useMemo(
    () => ({
      onCreate: async (input) => {
        await state.handleWriteAppSettings(wrap({ create: input }))
      },
      onUpdate: async (id, patch) => {
        await state.handleWriteAppSettings(wrap({ update: { id, patch } }))
      },
      onDelete: async (id) => {
        await state.handleWriteAppSettings(wrap({ delete: { id } }))
      },
    }),
    [wrap, state],
  )
}
