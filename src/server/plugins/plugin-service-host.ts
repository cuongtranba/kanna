
import type { AppSettingsManager } from "../app-settings"
import { createPluginService, type InstalledPluginStore, type PluginService } from "./plugin-service"

let instance: PluginService | null = null
let installedStore: InstalledPluginStore | null = null

export function configurePluginService(store: InstalledPluginStore): PluginService {
  installedStore = store
  instance = createPluginService({ installed: store })
  instance.restore()
  return instance
}

export function getPluginService(): PluginService {
  instance ??= createPluginService(installedStore ? { installed: installedStore } : {})
  return instance
}

export function setPluginServiceForTest(service: PluginService | null): void {
  instance = service
  if (service === null) installedStore = null
}

export function createPluginsHost(appSettings: Pick<AppSettingsManager, "getSnapshot">) {
  return {
    enabled: () => appSettings.getSnapshot().plugins.enabled,
    service: getPluginService,
  }
}
