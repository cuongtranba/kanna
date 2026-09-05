
export interface InstalledPluginConfig {
  readonly id: string
  readonly sourceDir: string
  readonly enabled: boolean
}

export interface PluginSettings {
  readonly enabled: boolean
}

export const PLUGIN_SETTINGS_DEFAULTS: PluginSettings = { enabled: false }
