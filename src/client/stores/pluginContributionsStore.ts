import { create } from "zustand"
import type { PluginFooterPanel } from "../app/PluginsFooterSection"
import type { PluginCommandCenterItem, PluginSidebarItem } from "../plugins/contributionRegistry"

const EMPTY_SIDEBAR_ITEMS: readonly PluginSidebarItem[] = []
const EMPTY_PANELS: readonly PluginFooterPanel[] = []
const EMPTY_COMMAND_CENTER_ITEMS: readonly PluginCommandCenterItem[] = []

export interface PluginContributions {
  readonly sidebarItems: readonly PluginSidebarItem[]
  readonly panels: readonly PluginFooterPanel[]
  readonly commandCenterItems: readonly PluginCommandCenterItem[]
}

interface PluginContributionsStoreState {
  sidebarItems: readonly PluginSidebarItem[]
  panels: readonly PluginFooterPanel[]
  commandCenterItems: readonly PluginCommandCenterItem[]
  setContributions: (contributions: PluginContributions) => void
  clearContributions: () => void
}

export const usePluginContributionsStore = create<PluginContributionsStoreState>()((set) => ({
  sidebarItems: EMPTY_SIDEBAR_ITEMS,
  panels: EMPTY_PANELS,
  commandCenterItems: EMPTY_COMMAND_CENTER_ITEMS,
  setContributions: ({ sidebarItems, panels, commandCenterItems }) =>
    set({ sidebarItems, panels, commandCenterItems }),
  clearContributions: () =>
    set((state) =>
      state.sidebarItems.length === 0 &&
      state.panels.length === 0 &&
      state.commandCenterItems.length === 0
        ? state
        : {
            sidebarItems: EMPTY_SIDEBAR_ITEMS,
            panels: EMPTY_PANELS,
            commandCenterItems: EMPTY_COMMAND_CENTER_ITEMS,
          },
    ),
}))

export const selectPluginSidebarItems = (
  state: PluginContributionsStoreState,
): readonly PluginSidebarItem[] => state.sidebarItems ?? EMPTY_SIDEBAR_ITEMS

export const selectPluginFooterPanels = (
  state: PluginContributionsStoreState,
): readonly PluginFooterPanel[] => state.panels ?? EMPTY_PANELS

export const selectPluginCommandCenterItems = (
  state: PluginContributionsStoreState,
): readonly PluginCommandCenterItem[] => state.commandCenterItems ?? EMPTY_COMMAND_CENTER_ITEMS
