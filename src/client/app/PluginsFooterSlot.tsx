import { PluginsFooterSection } from "./PluginsFooterSection"
import { selectPluginFooterPanels, usePluginContributionsStore } from "../stores/pluginContributionsStore"
import type { PluginTheme } from "../plugins/contributionRegistry"

const PLUGIN_THEME: PluginTheme = { colors: { foreground: "var(--foreground)" } }

export function PluginsFooterSlot() {
  const panels = usePluginContributionsStore(selectPluginFooterPanels)
  return <PluginsFooterSection panels={panels} theme={PLUGIN_THEME} />
}
