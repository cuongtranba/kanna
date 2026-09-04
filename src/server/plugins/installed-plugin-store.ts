/**
 * Binds `PluginService`'s installed-plugin records to `settings.json`.
 *
 * `settings.installedPlugins` already existed as a normalized, CRUD-backed
 * collection (`InstalledPluginConfig` = `{id, sourceDir, enabled}`) — it was
 * simply never connected to the service, so an install lived only in memory
 * and vanished on restart while its bundles sat on disk. This is the wire.
 *
 * The settings collection is the source of truth for WHICH plugins are
 * installed; the service owns everything about a plugin at RUNTIME (process,
 * connection, log ring, state). Keeping the split that way is why `upsert`
 * carries only the three durable fields.
 */

import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import type { InstalledPluginStore } from "./plugin-service"

/** The slice of `AppSettingsManager` this needs — injected so it stays testable. */
export interface InstalledPluginSettings {
  getSnapshot(): { installedPlugins?: readonly InstalledPluginConfig[] }
  writePatch(patch: {
    installedPlugins: {
      create?: { sourceDir: string; id: string }
      update?: { id: string; patch: { enabled?: boolean } }
    }
  }): Promise<unknown>
}

export function createInstalledPluginStore(settings: InstalledPluginSettings): InstalledPluginStore {
  return {
    list() {
      return settings.getSnapshot().installedPlugins ?? []
    },

    async upsert(entry: InstalledPluginConfig) {
      const existing = settings.getSnapshot().installedPlugins?.find((p) => p.id === entry.id)
      if (!existing) {
        // `create` carries only id + sourceDir; a freshly installed plugin is
        // disabled, which is also the collection's own default.
        await settings.writePatch({ installedPlugins: { create: { id: entry.id, sourceDir: entry.sourceDir } } })
        if (!entry.enabled) return
      }
      if (existing?.enabled === entry.enabled) return
      await settings.writePatch({ installedPlugins: { update: { id: entry.id, patch: { enabled: entry.enabled } } } })
    },
  }
}
