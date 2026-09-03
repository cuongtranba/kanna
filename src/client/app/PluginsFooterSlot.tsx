/**
 * Mount point for plugin-contributed chat-footer panels.
 *
 * A slot rather than rendering `PluginsFooterSection` directly in
 * `ChatTranscriptViewport.tsx`: that file sits two lines under the 700-line
 * architecture-budget threshold, so the store read and the theme have to live
 * somewhere else or the viewport crosses it and fails `check:arch` as
 * `module_unlisted`. This keeps the call site to one import and one element.
 *
 * `PluginsFooterSection` self-hides when nothing is contributed, so an install
 * with plugins disabled — the default — renders exactly nothing here.
 */
import { PluginsFooterSection } from "./PluginsFooterSection"
import { selectPluginFooterPanels, usePluginContributionsStore } from "../stores/pluginContributionsStore"
import type { PluginTheme } from "../plugins/contributionRegistry"

/**
 * Hoisted, not built per render: it is passed straight into a contributed
 * component's props, so a fresh object each render would re-render every plugin
 * surface on every transcript update.
 *
 * A CSS var rather than a resolved colour keeps a plugin surface on the host's
 * theme tokens through a light/dark switch without the host re-rendering it.
 */
const PLUGIN_THEME: PluginTheme = { colors: { foreground: "var(--foreground)" } }

export function PluginsFooterSlot() {
  const panels = usePluginContributionsStore(selectPluginFooterPanels)
  return <PluginsFooterSection panels={panels} theme={PLUGIN_THEME} />
}
