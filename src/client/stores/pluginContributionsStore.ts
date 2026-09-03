/**
 * What plugins have contributed to the running app, in one place the host
 * surfaces read from.
 *
 * The registry a plugin writes into (`../plugins/contributionRegistry.ts`) is a
 * plain mutable object built per load; this store is its React-visible
 * projection, so the sidebar and the chat footer re-render when a load or a
 * reload changes what is contributed.
 *
 * Both selectors fall back to a MODULE-LEVEL `EMPTY` rather than an inline
 * `?? []`. An inline fallback mints a fresh array on every call, which is
 * exactly the React error #185 shape `rules/no-unstable-selector-fallback`
 * bans — and these two are the common case, since plugins are off by default.
 */
import { create } from "zustand"
import type { PluginFooterPanel } from "../app/PluginsFooterSection"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"

const EMPTY_SIDEBAR_ITEMS: readonly PluginSidebarItem[] = []
const EMPTY_PANELS: readonly PluginFooterPanel[] = []

interface PluginContributionsStoreState {
  sidebarItems: readonly PluginSidebarItem[]
  panels: readonly PluginFooterPanel[]
  setContributions: (sidebarItems: readonly PluginSidebarItem[], panels: readonly PluginFooterPanel[]) => void
  clearContributions: () => void
}

export const usePluginContributionsStore = create<PluginContributionsStoreState>()((set) => ({
  sidebarItems: EMPTY_SIDEBAR_ITEMS,
  panels: EMPTY_PANELS,
  setContributions: (sidebarItems, panels) => set({ sidebarItems, panels }),
  // Restores the shared EMPTY identities rather than fresh literals, so a clear
  // on an already-empty store leaves every selector's value untouched and
  // nothing re-renders.
  clearContributions: () =>
    set((state) =>
      state.sidebarItems.length === 0 && state.panels.length === 0
        ? state
        : { sidebarItems: EMPTY_SIDEBAR_ITEMS, panels: EMPTY_PANELS },
    ),
}))

export const selectPluginSidebarItems = (
  state: PluginContributionsStoreState,
): readonly PluginSidebarItem[] => state.sidebarItems ?? EMPTY_SIDEBAR_ITEMS

export const selectPluginFooterPanels = (
  state: PluginContributionsStoreState,
): readonly PluginFooterPanel[] => state.panels ?? EMPTY_PANELS
