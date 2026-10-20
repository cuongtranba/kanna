import { useMemo } from "react"
import { selectInstalledPlugins, useAppSettingsStore } from "../stores/appSettingsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { buildPluginsSectionHandlers, PluginsSection } from "./PluginsSection"

export function KannaPluginsSettingsBranch() {
  const plugins = useAppSettingsStore(selectInstalledPlugins)
  const socket = useOptionalKannaSocket()
  const handlers = useMemo(() => buildPluginsSectionHandlers(socket), [socket])
  return <PluginsSection plugins={plugins} handlers={handlers} />
}
