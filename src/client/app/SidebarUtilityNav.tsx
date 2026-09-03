/**
 * The sidebar's bottom nav: Workflows / Cron jobs / Settings, the connection
 * status row, and any sidebar items PLUGINS have contributed.
 *
 * Extracted from `KannaSidebar.tsx`, which sits on its architecture-budget
 * ceiling and therefore had no room for a new entry. Plugin items belong here
 * rather than in the chat list: an `addSidebarItem` contribution is a
 * navigation destination, exactly like the three built-ins beside it.
 *
 * `PluginSidebarItems` self-hides when nothing is contributed, so a install
 * with plugins disabled renders this block exactly as it renders today.
 */
import { CalendarClock, Settings, Workflow } from "lucide-react"
import type { NavigateFunction } from "react-router-dom"
import { cn } from "../lib/utils"
import { HoverHint } from "../components/ui/truncated-text"
import { PluginSidebarItems } from "./PluginSidebarItems"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"

export interface SidebarUtilityNavProps {
  readonly activeChatId: string | null
  readonly navigate: NavigateFunction
  readonly onClose: () => void
  readonly workflowsButtonClass: string
  readonly isCronJobsActive: boolean
  readonly isSettingsActive: boolean
  readonly statusDotClass: string
  readonly statusLabel: string
  readonly pluginItems: readonly PluginSidebarItem[]
  readonly onSelectPluginItem?: (item: PluginSidebarItem) => void
}

export function SidebarUtilityNav({
  activeChatId,
  navigate,
  onClose,
  workflowsButtonClass,
  isCronJobsActive,
  isSettingsActive,
  statusDotClass,
  statusLabel,
  pluginItems,
  onSelectPluginItem,
}: SidebarUtilityNavProps) {
  return (
  <div className="border-t border-border">
    <HoverHint label={activeChatId ? "Open workflows" : "Open a chat to view workflows"} side="right">
      <button
        type="button"
        aria-disabled={!activeChatId}
        aria-label={activeChatId ? "Workflows" : "Workflows — open a chat to view"}
        onClick={() => {
          if (!activeChatId) return
          navigate(`/workflows/${activeChatId}`)
          onClose()
        }}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 rounded-none",
          workflowsButtonClass
        )}
      >
        <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm flex-1">Workflows</span>
      </button>
    </HoverHint>
    <button
      type="button"
      onClick={() => {
        navigate("/cron")
        onClose()
      }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 rounded-none",
        isCronJobsActive ? "bg-muted" : "hover:bg-muted/50"
      )}
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm flex-1">Cron jobs</span>
    </button>
    <button
      type="button"
      onClick={() => {
        navigate("/settings/general")
        onClose()
      }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 rounded-none",
        isSettingsActive
          ? "bg-muted"
          : "hover:bg-muted/50"
      )}
    >
      <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm flex-1">Settings</span>
    </button>
    <PluginSidebarItems items={pluginItems} onSelect={onSelectPluginItem} />
    <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
      <span
        className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDotClass)}
        aria-hidden
      />
      <span className="text-xs text-muted-foreground tabular-nums">{statusLabel}</span>
    </div>
  </div>
  )
}
