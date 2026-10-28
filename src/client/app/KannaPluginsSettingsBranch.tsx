import { useMemo } from "react"
import { selectInstalledPlugins, selectPluginsEnabled, useAppSettingsStore } from "../stores/appSettingsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { buildKannaPluginsSectionHandlers, KannaPluginsSection } from "./KannaPluginsSection"

export function KannaPluginsSettingsBranch() {
  const pluginsEnabled = useAppSettingsStore(selectPluginsEnabled)
  const plugins = useAppSettingsStore(selectInstalledPlugins)
  const socket = useOptionalKannaSocket()
  const handlers = useMemo(() => buildKannaPluginsSectionHandlers(socket), [socket])
  if (!pluginsEnabled) return null
  return <KannaPluginsSection plugins={plugins} handlers={handlers} />
}
