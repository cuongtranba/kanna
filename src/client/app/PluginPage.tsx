import { Blocks } from "lucide-react"
import { PluginBoundary } from "../plugins/PluginBoundary"
import { selectPluginFooterPanels, usePluginContributionsStore } from "../stores/pluginContributionsStore"
import { PLUGIN_THEME } from "./PluginsFooterSlot"

export interface PluginPageProps {
  readonly pluginId: string
  readonly surfaceId: string
}

export function PluginPage({ pluginId, surfaceId }: PluginPageProps) {
  const panels = usePluginContributionsStore(selectPluginFooterPanels)
  const panel = panels.find((entry) => entry.pluginId === pluginId && entry.surfaceId === surfaceId)

  if (!panel) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
        data-testid={`plugin-page-missing:${pluginId}:${surfaceId}`}
      >
        <Blocks className="size-5" aria-hidden />
        <p>Plugin &quot;{pluginId}&quot; has no surface &quot;{surfaceId}&quot; loaded.</p>
        <p>Check that it is installed and enabled under Settings → Plugins.</p>
      </div>
    )
  }

  const { Component } = panel
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background" data-testid={`plugin-page:${pluginId}:${surfaceId}`}>
      <PluginBoundary pluginId={pluginId}>
        <Component theme={PLUGIN_THEME} />
      </PluginBoundary>
    </div>
  )
}
