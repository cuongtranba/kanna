import type { ComponentType } from "react"
import type { JsonValue } from "../../shared/json"

export interface PluginTheme {
  readonly colors: {
    readonly foreground: string
  }
}

export interface PluginSurfaceProps {
  readonly theme: PluginTheme
}

export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

export interface PluginSidebarItemInput {
  readonly id: string
  readonly title: string
  readonly icon: string
  readonly surface: string
}

export interface PluginSidebarItem extends PluginSidebarItemInput {
  readonly pluginId: string
}

export interface PluginCommandCenterItemInput {
  readonly name: string
  readonly description: string
  readonly prompt: string
}

export interface PluginCommandCenterItem extends PluginCommandCenterItemInput {
  readonly pluginId: string
}

export interface PluginSurfaceEntry {
  readonly pluginId: string
  readonly surfaceId: string
  readonly Component: PluginSurfaceComponent
}

export interface PluginContributionRegistry {
  getCommandCenterItems(): PluginCommandCenterItem[]
  getSidebarItems(): PluginSidebarItem[]
  getSurface(pluginId: string, surfaceId: string): PluginSurfaceComponent | undefined
  getSurfaceEntries(): PluginSurfaceEntry[]
  registerCommandCenterItem(pluginId: string, item: PluginCommandCenterItemInput): void
  registerSidebarItem(pluginId: string, item: PluginSidebarItemInput): void
  registerSurface(pluginId: string, surfaceId: string, component: PluginSurfaceComponent): void
}

function surfaceKey(pluginId: string, surfaceId: string): string {
  return `${pluginId}:${surfaceId}`
}

export function createPluginContributionRegistry(): PluginContributionRegistry {
  const sidebarItems: PluginSidebarItem[] = []
  const commandCenterItems: PluginCommandCenterItem[] = []
  const surfaces = new Map<string, PluginSurfaceComponent>()
  const surfaceEntries: PluginSurfaceEntry[] = []

  return {
    getCommandCenterItems() {
      return [...commandCenterItems]
    },
    getSidebarItems() {
      return [...sidebarItems]
    },
    getSurface(pluginId, surfaceId) {
      return surfaces.get(surfaceKey(pluginId, surfaceId))
    },
    getSurfaceEntries() {
      return [...surfaceEntries]
    },
    registerCommandCenterItem(pluginId, item) {
      commandCenterItems.push({ pluginId, ...item })
    },
    registerSidebarItem(pluginId, item) {
      sidebarItems.push({ pluginId, ...item })
    },
    registerSurface(pluginId, surfaceId, component) {
      surfaces.set(surfaceKey(pluginId, surfaceId), component)
      const entry: PluginSurfaceEntry = { pluginId, surfaceId, Component: component }
      const index = surfaceEntries.findIndex(
        (existing) => existing.pluginId === pluginId && existing.surfaceId === surfaceId,
      )
      if (index >= 0) surfaceEntries[index] = entry
      else surfaceEntries.push(entry)
    },
  }
}

export interface PluginContext {
  addSurface(id: string, component: PluginSurfaceComponent): void
  addSidebarItem(item: PluginSidebarItemInput): void
  addCommandCenterItem(item: PluginCommandCenterItemInput): void
  handle(...args: JsonValue[]): void
}

export function createPluginContext(pluginId: string, registry: PluginContributionRegistry): PluginContext {
  return {
    addSurface(id, component) {
      registry.registerSurface(pluginId, id, component)
    },
    addSidebarItem(item) {
      registry.registerSidebarItem(pluginId, item)
    },
    addCommandCenterItem(item) {
      registry.registerCommandCenterItem(pluginId, item)
    },
    handle() {},
  }
}
