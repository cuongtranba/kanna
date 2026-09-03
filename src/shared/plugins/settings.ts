/**
 * Persisted settings shapes for the plugin system.
 *
 * Deliberately separate from `manifest.ts`: a manifest describes what a
 * plugin's OWN `kanna-plugin.json` declares about itself, while this file
 * describes what Kanna's `settings.json` records about a plugin it has
 * installed — a different concern with a different lifecycle (a manifest is
 * immutable per-version; `enabled` flips independently of it).
 */

/**
 * One row of Kanna's installed-plugins collection. `id` mirrors the
 * plugin's own manifest id (validated against `PLUGIN_ID_PATTERN` at
 * install time); `sourceDir` is the absolute path Kanna installed it from.
 */
export interface InstalledPluginConfig {
  readonly id: string
  readonly sourceDir: string
  readonly enabled: boolean
}

/**
 * The global plugin-system switch. Plugins are OFF by default: the whole
 * surface (HTTP routes, MCP authoring tools, client host registry) stays
 * dark until a user opts in, even after installing one.
 */
export interface PluginSettings {
  readonly enabled: boolean
}

export const PLUGIN_SETTINGS_DEFAULTS: PluginSettings = { enabled: false }
