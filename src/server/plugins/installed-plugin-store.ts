
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import type { InstalledPluginStore } from "./plugin-service"

export interface InstalledPluginSettings<TWriteResult> {
  getSnapshot(): { installedPlugins?: readonly InstalledPluginConfig[] }
  writePatch(patch: {
    installedPlugins: {
      create?: { sourceDir: string; id: string }
      update?: { id: string; patch: { enabled?: boolean } }
    }
  }): Promise<TWriteResult>
}

export function createInstalledPluginStore<TWriteResult>(
  settings: InstalledPluginSettings<TWriteResult>,
): InstalledPluginStore {
  return {
    list() {
      return settings.getSnapshot().installedPlugins ?? []
    },

    async upsert(entry: InstalledPluginConfig) {
      const existing = settings.getSnapshot().installedPlugins?.find((p) => p.id === entry.id)
      if (!existing) {
        await settings.writePatch({ installedPlugins: { create: { id: entry.id, sourceDir: entry.sourceDir } } })
        if (!entry.enabled) return
      }
      if (existing?.enabled === entry.enabled) return
      await settings.writePatch({ installedPlugins: { update: { id: entry.id, patch: { enabled: entry.enabled } } } })
    },
  }
}
