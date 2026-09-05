import { useEffect } from "react"
import { loadPluginContributionsFromServer } from "./loadPluginContributions"
import { usePluginContributionsStore } from "../stores/pluginContributionsStore"
import { selectPluginsEnabled, useAppSettingsStore } from "../stores/appSettingsStore"
import { log } from "../../shared/log"

export function usePluginContributions(reloadToken: string = ""): void {
  const enabled = useAppSettingsStore(selectPluginsEnabled)

  useEffect(() => {
    const { setContributions, clearContributions } = usePluginContributionsStore.getState()

    if (!enabled) {
      clearContributions()
      return
    }

    let cancelled = false
    void loadPluginContributionsFromServer(reloadToken)
      .then((loaded) => {
        if (cancelled) return
        setContributions(loaded)
        for (const failure of loaded.failures) {
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
