import { useCallback } from "react"
import { Blocks } from "lucide-react"
import { Button } from "../components/ui/button"
import { StateMarkLabel } from "../components/ui/state-mark"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import type { CommandPort } from "../ports/commandPort"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"

export interface PluginsSectionHandlers {
  readonly onReload: (id: string) => Promise<void>
}

export function buildPluginsSectionHandlers(commands: CommandPort | null): PluginsSectionHandlers {
  return {
    async onReload(id) {
      await sendCommandWithFeedback(commands, { type: "plugins.reload", pluginId: id })
    },
  }
}

export interface PluginsSectionProps {
  readonly plugins: readonly InstalledPluginConfig[]
  readonly handlers: PluginsSectionHandlers
}

export function PluginsSection({ plugins, handlers }: PluginsSectionProps) {
  if (plugins.length === 0) {
    return <SettingsEmptyState icon={Blocks} message="No plugins installed yet." />
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">Plugins</h2>
      <SettingsList>
        {plugins.map((plugin) => (
          <PluginRow key={plugin.id} plugin={plugin} onReload={handlers.onReload} />
        ))}
      </SettingsList>
    </div>
  )
}

function PluginRow({
  plugin,
  onReload,
}: {
  plugin: InstalledPluginConfig
  onReload: (id: string) => Promise<void>
}) {
  const reloadKey = pendingActionKey("plugins.reload", plugin.id)
  const reloading = usePendingAction(reloadKey)
  const handleReload = useCallback(() => {
    runPendingAction(reloadKey, () => onReload(plugin.id))
  }, [onReload, plugin.id, reloadKey])

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{plugin.id}</span>
          <StateMarkLabel tone={plugin.enabled ? "active" : "muted"} label={plugin.enabled ? "Enabled" : "Disabled"} />
        </span>
        <span className="truncate text-xs text-muted-foreground">{plugin.sourceDir}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        data-testid={`plugin-reload:${plugin.id}`}
        pending={reloading}
        onClick={handleReload}
      >
        Reload
      </Button>
    </li>
  )
}
