/**
 * The Settings -> "Kanna plugins" branch: the one place `PluginsSection`
 * (`./PluginsSection.tsx`) is mounted into the real app.
 *
 * `PluginsSection` takes its data and its one action as props so the
 * acceptance oracle can drive it with a bare fake. This branch is the
 * production wiring of those two seams and nothing else — the installed list
 * comes from the settings snapshot (`selectInstalledPlugins`, whose fallback is
 * a module-level `EMPTY` so the selector is reference-stable), and the reload
 * action is `httpAdapter.postJsonBody` bound once at module scope, so the
 * handlers object is a constant rather than a fresh identity per render.
 *
 * Kept out of `SettingsPage.tsx` deliberately: that module sits at an exact
 * `MODULE_ALLOWANCES` ceiling, so a branch belongs beside its section (the
 * shape `SubagentsSettingsBranch` / `ModelsSettingsBranch` already use), not
 * inline in the page.
 */
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
