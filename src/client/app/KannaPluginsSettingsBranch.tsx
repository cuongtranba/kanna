import type { JsonValue } from "../../shared/json"
import { httpAdapter } from "../adapters/http.adapter"
import { selectInstalledPlugins, useAppSettingsStore } from "../stores/appSettingsStore"
import { buildPluginsSectionHandlers, PluginsSection } from "./PluginsSection"

async function postPluginJson(url: string, body: JsonValue): Promise<{ readonly ok: boolean }> {
  const response = await httpAdapter.postJsonBody<null>(url, body)
  return { ok: response.ok }
}

const PLUGIN_HANDLERS = buildPluginsSectionHandlers(postPluginJson)

export function KannaPluginsSettingsBranch() {
  const plugins = useAppSettingsStore(selectInstalledPlugins)
  return <PluginsSection plugins={plugins} handlers={PLUGIN_HANDLERS} />
}
