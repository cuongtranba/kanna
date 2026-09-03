/**
 * Chat-footer panel for contributed plugin surfaces. Mirrors the
 * card/header/row shape `LoopProgressSection.tsx` and
 * `BackgroundTasksSection.tsx` use (rounded-2xl card, `h3` header row with
 * icon + title, flat list of rows below) rather than `WorkflowsSection.tsx`'s
 * heavier run-detail-dialog shape, which has no analog here.
 *
 * Each panel is wrapped in `PluginBoundary` — a throw inside one contributed
 * surface must not take the rest of the footer, or the chat UI, down with it.
 */
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
