/**
 * Loads plugin contributions into the store the host surfaces read from.
 *
 * This is the one place that turns "plugins are enabled" into "the sidebar and
 * the chat footer show what plugins contributed". Without it the store stays
 * empty forever and every mounted surface self-hides — which is exactly the
 * state the feature was in before: components written, mounted nowhere, and
 * nothing feeding them.
 *
 * Load is keyed on the global switch AND on a caller-supplied `reloadToken`, so
 * `plugin reload` / the Settings page's Reload button can force a re-evaluation
 * under a fresh cache-busting url without remounting the app.
 *
 * A load that loses a race is discarded (`cancelled`): toggling the switch twice
 * quickly must not let the first response overwrite the second.
 */
import { useEffect } from "react"
import { loadPluginContributionsFromServer } from "./loadPluginContributions"
import { usePluginContributionsStore } from "../stores/pluginContributionsStore"
import { selectPluginsEnabled, useAppSettingsStore } from "../stores/appSettingsStore"
import { log } from "../../shared/log"

export function usePluginContributions(reloadToken: string = ""): void {
  const enabled = useAppSettingsStore(selectPluginsEnabled)

  useEffect(() => {
    // Read the actions off the store directly rather than subscribing to them:
    // subscribing would re-run this effect whenever the store changes, and the
    // effect's own `setContributions` is one of those changes.
    const { setContributions, clearContributions } = usePluginContributionsStore.getState()

    if (!enabled) {
      clearContributions()
      return
    }

    let cancelled = false
    void loadPluginContributionsFromServer(reloadToken)
      .then((loaded) => {
        if (cancelled) return
        setContributions(loaded.sidebarItems, loaded.panels)
        for (const failure of loaded.failures) {
          // One plugin failing is contained, not fatal — surface it without
          // taking down the load of the others.
          log.warn("[kanna/plugins] plugin failed to load", failure.pluginId, failure.message)
        }
      })
      .catch((error) => {
        if (cancelled) return
        log.warn("[kanna/plugins] contribution load failed", String(error))
      })

    return () => {
      cancelled = true
    }
  }, [enabled, reloadToken])
}
