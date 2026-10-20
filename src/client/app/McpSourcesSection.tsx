import { useCallback, useMemo } from "react"
import { Antenna, Plus } from "lucide-react"
import type { McpSource, McpSourceInput, McpSourcePatch, McpSourceStatus } from "../../shared/mcp-sources/types"
import type { McpServerConfig, SidebarData } from "../../shared/types"
import { Button } from "../components/ui/button"
import { StateMarkLabel } from "../components/ui/state-mark"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import { useNow } from "../hooks/useNow"
import { formatSidebarAgeLabel } from "../lib/formatters"
import { mcpSourceModeLabel, mcpSourceStateLabel, mcpSourceStateTone } from "../lib/mcpSourcePresentation"
import { selectCustomMcpServers, selectMcpSources, useAppSettingsStore } from "../stores/appSettingsStore"
import { useMcpSourcesSectionStore } from "../stores/mcpSourcesSectionStore"
import { useMcpSourcesStore } from "../stores/mcpSourcesStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useAppSettingsCrudHandlers, type AppSettingsCrudHandlers, type AppSettingsPatchWrapper } from "./appSettingsCrud"
import { McpSourceForm } from "./McpSourceForm"
import type { KannaState } from "./useKannaState"

export interface McpSourcesSectionHandlers extends AppSettingsCrudHandlers<McpSourceInput, McpSourcePatch> {
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
}

const wrapMcpSourcesPatch: AppSettingsPatchWrapper<McpSourceInput, McpSourcePatch> = (mcpSources) => ({ mcpSources })

interface RowProps {
  source: McpSource
  serverName: string
  status: McpSourceStatus | undefined
  now: number
  confirmingDelete: boolean
  handlers: McpSourcesSectionHandlers
}

function McpSourceRow({ source, serverName, status, now, confirmingDelete, handlers }: RowProps) {
  const startEdit = useMcpSourcesSectionStore((state) => state.startEdit)
  const askDelete = useMcpSourcesSectionStore((state) => state.askDelete)
  const cancelDelete = useMcpSourcesSectionStore((state) => state.cancelDelete)
  const enabledKey = pendingActionKey("mcpSources.setEnabled", source.id)
  const deleteKey = pendingActionKey("mcpSources.delete", source.id)
  const enabledPending = usePendingAction(enabledKey)
  const deletePending = usePendingAction(deleteKey)
  const state = status?.state ?? (source.enabled ? "connecting" : "disabled")
  const lastItem = formatSidebarAgeLabel(status?.lastItemAt ?? undefined, now)

  const handleToggle = useCallback(() => {
    runPendingAction(enabledKey, () => handlers.onSetEnabled(source.id, !source.enabled))
  }, [enabledKey, handlers, source.enabled, source.id])
  const handleEdit = useCallback(() => startEdit(source), [source, startEdit])
  const handleAskDelete = useCallback(() => askDelete(source.id), [askDelete, source.id])
  const handleConfirmDelete = useCallback(() => {
    runPendingAction(deleteKey, async () => {
      await handlers.onDelete(source.id)
      cancelDelete()
    })
  }, [cancelDelete, deleteKey, handlers, source.id])

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" aria-busy={enabledPending || deletePending || undefined}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{source.name}</span>
        <span className="truncate text-xs text-muted-foreground">{serverName} · {mcpSourceModeLabel(source.mode)}</span>
        {status?.lastError ? <span className="text-xs text-destructive-text">{status.lastError}</span> : null}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <StateMarkLabel tone={mcpSourceStateTone(state)} label={mcpSourceStateLabel(state)} />
        <span className="tabular-nums">{lastItem ? `last ${lastItem}` : "no items yet"}</span>
        <span className="tabular-nums">{status?.itemCount ?? 0} items</span>
        <Button variant="secondary" size="sm" onClick={handleToggle} pending={enabledPending}>
          {source.enabled ? "Disable" : "Enable"}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleEdit} aria-label={`Edit ${source.name}`}>Edit</Button>
        {confirmingDelete ? (
          <>
            <Button variant="destructive" size="sm" onClick={handleConfirmDelete} pending={deletePending}>Delete {source.name}?</Button>
            <Button variant="ghost" size="sm" onClick={cancelDelete} disabled={deletePending}>Keep</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={handleAskDelete} aria-label={`Delete ${source.name}`}>Delete</Button>
        )}
      </div>
    </li>
  )
}

interface SectionProps {
  sources: readonly McpSource[]
  statuses: readonly McpSourceStatus[]
  servers: readonly McpServerConfig[]
  sidebarData: SidebarData
  handlers: McpSourcesSectionHandlers
}

export function McpSourcesSection({ sources, statuses, servers, sidebarData, handlers }: SectionProps) {
  const editing = useMcpSourcesSectionStore((state) => state.editing)
  const confirmingDeleteId = useMcpSourcesSectionStore((state) => state.confirmingDeleteId)
  const startCreate = useMcpSourcesSectionStore((state) => state.startCreate)
  const now = useNow(30_000)

  if (editing.kind !== "list") {
    const current = editing.kind === "edit" ? (sources.find((source) => source.id === editing.id) ?? null) : null
    return <McpSourceForm editing={current} servers={servers} sidebarData={sidebarData} handlers={handlers} />
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">MCP sources</h2>
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            Let Kanna listen to an MCP server you already added, such as a Zalo or mail server, and put what arrives
            into the Inbox. Replies go back out through the same server.
          </p>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Add source
        </Button>
      </div>

      {sources.length === 0 ? (
        <SettingsEmptyState icon={Antenna} message="No MCP sources yet. Add one to bring a server's messages into the Inbox." />
      ) : (
        <SettingsList>
          {sources.map((source) => (
            <McpSourceRow
              key={source.id}
              source={source}
              serverName={servers.find((server) => server.id === source.serverId)?.name ?? "Missing server"}
              status={statuses.find((status) => status.id === source.id)}
              now={now}
              confirmingDelete={confirmingDeleteId === source.id}
              handlers={handlers}
            />
          ))}
        </SettingsList>
      )}
    </div>
  )
}

export function McpSourcesSettingsBranch({ state }: { state: Pick<KannaState, "handleWriteAppSettings" | "sidebarData"> }) {
  const sources = useAppSettingsStore(selectMcpSources)
  const servers = useAppSettingsStore(selectCustomMcpServers)
  const statuses = useMcpSourcesStore((store) => store.statuses)
  const crud = useAppSettingsCrudHandlers(wrapMcpSourcesPatch, state)
  const { handleWriteAppSettings } = state
  const handlers = useMemo<McpSourcesSectionHandlers>(
    () => ({
      ...crud,
      onSetEnabled: async (id, enabled) => {
        await handleWriteAppSettings({ mcpSources: { setEnabled: { id, enabled } } })
      },
    }),
    [crud, handleWriteAppSettings],
  )
  return <McpSourcesSection sources={sources} statuses={statuses} servers={servers} sidebarData={state.sidebarData} handlers={handlers} />
}
