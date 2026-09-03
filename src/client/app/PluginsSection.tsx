/**
 * Settings → Plugins page: lists installed plugins and drives the
 * auth-gated actions `plugin-http-routes.ts` recognises (`POST
 * /api/plugins/:id/reload` today; `/logs`, `/rpc`, `/client-error` stay
 * server-side 501 stubs until `plugin-service.ts` is wired into the HTTP
 * surface, a later chunk).
 *
 * `buildPluginsSectionHandlers` takes an injectable POST-JSON primitive
 * rather than the full `HttpPort` — the same DI shape `api/auth.ts`'s
 * `postAuthLogin` uses, narrowed to the one call this page makes — so the
 * acceptance oracle can assert the exact URL/method it hits with a bare fake.
 * A real caller wires it to `httpAdapter.postJson`.
 */
import { Blocks } from "lucide-react"
import { Button } from "../components/ui/button"
import { StatusPill } from "../components/ui/status-pill"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import { type AnyValue } from "../../shared/errors"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"

export type PostJsonBodyFn = (url: string, body: AnyValue) => Promise<{ readonly ok: boolean }>

export interface PluginsSectionHandlers {
  readonly onReload: (id: string) => Promise<void>
}

export function buildPluginsSectionHandlers(postJsonBody: PostJsonBodyFn): PluginsSectionHandlers {
  return {
    async onReload(id) {
      await postJsonBody(`/api/plugins/${id}/reload`, {})
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
        onClick={() => {
          void onReload(plugin.id)
        }}
      >
        Reload
      </Button>
    </li>
  )
}
