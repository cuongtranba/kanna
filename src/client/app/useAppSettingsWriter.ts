import { useCallback } from "react"
import { onRejected } from "../../shared/errors"
import type { AppSettingsPatch } from "../../shared/types"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import type { KannaState } from "./useKannaState"

export function useAppSettingsWriter(state: Pick<KannaState, "handleWriteAppSettings">) {
  const setAppSettingsError = useGeneralSettingsStore((s) => s.setAppSettingsError)
  const { handleWriteAppSettings } = state

  const report = useCallback((error: Error) => setAppSettingsError(error.message), [setAppSettingsError])

  const write = useCallback(
    (patch: AppSettingsPatch) => {
      void handleWriteAppSettings(patch).catch(onRejected(report))
    },
    [handleWriteAppSettings, report],
  )

  const writeAsync = useCallback(
    (patch: AppSettingsPatch) => handleWriteAppSettings(patch).catch(onRejected(report)),
    [handleWriteAppSettings, report],
  )

  return { write, writeAsync }
}
