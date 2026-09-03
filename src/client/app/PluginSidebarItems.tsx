/**
 * Renders the sidebar entries plugins contribute via
 * `plugin.addSidebarItem(...)` (`../plugins/contributionRegistry.ts`). One
 * item per (pluginId, id) pair; `icon` is a small named-icon string rather
 * than an open catalog lookup, mirroring the `toolIcons` convention in
 * `../components/messages/shared.tsx`.
 */
import { Blocks, type LucideIcon } from "lucide-react"
import { cn } from "../lib/utils"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"

const PLUGIN_SIDEBAR_ICONS: Record<string, LucideIcon> = {
  Blocks,
}

function resolvePluginIcon(name: string): LucideIcon {
  return PLUGIN_SIDEBAR_ICONS[name] ?? Blocks
}

function itemKey(item: PluginSidebarItem): string {
  return `${item.pluginId}:${item.id}`
}

export interface PluginSidebarItemsProps {
  readonly items: readonly PluginSidebarItem[]
  readonly selectedKey?: string | null
  readonly onSelect?: (item: PluginSidebarItem) => void
}

export function PluginSidebarItems({ items, selectedKey, onSelect }: PluginSidebarItemsProps) {
  if (items.length === 0) return null

  return (
    <ul className="flex flex-col gap-0.5" data-testid="plugin-sidebar-items">
      {items.map((item) => {
        const Icon = resolvePluginIcon(item.icon)
        const key = itemKey(item)
        const selected = key === selectedKey
        return (
          <li key={key}>
            <button
              type="button"
              data-testid={`plugin-sidebar-item:${key}`}
              disabled={!onSelect}
              onClick={onSelect ? () => onSelect(item) : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
                selected && "bg-muted font-medium",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{item.title}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
