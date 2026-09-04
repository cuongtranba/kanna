/**
 * What plugins have contributed to the running app, in one place the host
 * surfaces read from.
 *
 * The registry a plugin writes into (`../plugins/contributionRegistry.ts`) is a
 * plain mutable object built per load; this store is its React-visible
 * projection, so the sidebar and the chat footer re-render when a load or a
 * reload changes what is contributed.
 *
 * Every selector falls back to a MODULE-LEVEL `EMPTY` rather than an inline
 * `?? []`. An inline fallback mints a fresh array on every call, which is
 * exactly the React error #185 shape `rules/no-unstable-selector-fallback`
 * bans — and all three are the common case, since plugins are off by default.
 * The `/`-picker selector is the sharpest of the three: it feeds a `useMemo`
 * that the composer's typeahead re-derives its option list from, so a fresh
 * array per call would rebuild that list on every keystroke.
 *
 * `setContributions` takes ONE object rather than a positional list. Each
 * contribution surface added to the plugin ABI would otherwise append a
 * parameter, and an omitted positional at a call site is not a type error —
 * exactly the silent-data-loss shape `buildEnqueueMessageResult` records.
 */
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
  // Restores the shared EMPTY identities rather than fresh literals, so a clear
  // on an already-empty store leaves every selector's value untouched and
  // nothing re-renders.
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
