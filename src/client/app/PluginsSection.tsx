import { useCallback } from "react"
import { Blocks } from "lucide-react"
import { Button } from "../components/ui/button"
import { StatusPill } from "../components/ui/status-pill"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import { errorMessage } from "../../shared/errors"
import type { JsonValue } from "../../shared/json"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"

export type PostJsonBodyFn = (url: string, body: JsonValue) => Promise<{ readonly ok: boolean }>

export interface PluginsSectionHandlers {
  readonly onReload: (id: string) => Promise<void>
}

export function buildPluginsSectionHandlers(postJsonBody: PostJsonBodyFn): PluginsSectionHandlers {
  return {
    async onReload(id) {
      const response = await postJsonBody(`/api/plugins/${id}/reload`, {})
      if (!response.ok) throw new Error(`Failed to reload plugin ${id}`)
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
    runPendingAction(reloadKey, async () => {
      try {
        await onReload(plugin.id)
        useKannaStateStore.getState().setCommandError(null)
      } catch (error) {
        useKannaStateStore.getState().setCommandError(errorMessage(error))
        throw error
      }
    })
  }, [onReload, plugin.id, reloadKey])

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{plugin.id}</span>
          <StatusPill tone={plugin.enabled ? "active" : "muted"} label={plugin.enabled ? "Enabled" : "Disabled"} />
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
