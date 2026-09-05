import { Blocks } from "lucide-react"
import { cn } from "../lib/utils"
import { PluginBoundary } from "../plugins/PluginBoundary"
import type { PluginSurfaceComponent, PluginTheme } from "../plugins/contributionRegistry"

export interface PluginFooterPanel {
  readonly pluginId: string
  readonly surfaceId: string
  readonly Component: PluginSurfaceComponent
}

export interface PluginsFooterSectionProps {
  readonly panels: readonly PluginFooterPanel[]
  readonly theme: PluginTheme
}

export function PluginsFooterSection({ panels, theme }: PluginsFooterSectionProps) {
  if (panels.length === 0) return null

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-border overflow-hidden">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border flex items-center gap-2">
          <Blocks className="h-4 w-4 text-muted-foreground" aria-hidden />
          Plugins
        </h3>
        <div>
          {panels.map((panel, index) => {
            const isLast = index === panels.length - 1
            const { Component } = panel
            return (
              <div
                key={`${panel.pluginId}:${panel.surfaceId}`}
                className={cn("px-4 py-3 bg-background", !isLast && "border-b border-border")}
              >
                <PluginBoundary pluginId={panel.pluginId}>
                  <Component theme={theme} />
                </PluginBoundary>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
