import { useMemo } from "react"
import type { AppSettingsPatch } from "../../shared/types"
import type { KannaState } from "./useKannaState"

export interface AppSettingsCrudBranch<Input, Patch> {
  create?: Input
  update?: { id: string; patch: Patch }
  delete?: { id: string }
}

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
