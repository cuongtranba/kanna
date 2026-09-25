import { useCallback, type ChangeEvent } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "../components/ui/button"
import { Spinner } from "../components/ui/spinner"
import { HoverHint } from "../components/ui/truncated-text"
import { SettingsRowActions } from "../components/settings/SettingsList"
import { cn } from "../lib/utils"
import { useMcpServersSectionStore } from "../stores/mcpServersSectionStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import type { McpOAuthState, McpServerConfig, McpServerTestResult, McpServerTransport } from "../../shared/types"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export interface McpRowHandlers {
  onDelete: (id: string) => Promise<void>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onTest: (id: string) => Promise<void>
}

export function McpRow({
  server,
  handlers,
  onEdit,
  dom = domAdapter,
}: {
  server: McpServerConfig
  handlers: McpRowHandlers
  onEdit: () => void
  dom?: DomPort
}) {
  const testing = useMcpServersSectionStore((s) => s.testingServerIds.has(server.id))
  const setServerTesting = useMcpServersSectionStore((s) => s.setServerTesting)

  const onTest = useCallback(async () => {
    setServerTesting(server.id, true)
    try {
      await handlers.onTest(server.id)
    } finally {
      setServerTesting(server.id, false)
    }
  }, [handlers, server.id, setServerTesting])

  const deleteKey = pendingActionKey("mcpServers.delete", server.id)
  const deletePending = usePendingAction(deleteKey)
  const setEnabledKey = pendingActionKey("mcpServers.setEnabled", server.id)
  const setEnabledPending = usePendingAction(setEnabledKey)
  const testKey = pendingActionKey("settings.testMcpServer", server.id)

  const onDelete = useCallback(() => {
    if (dom.confirmDialog(`Delete MCP server "${server.name}"?`)) {
      runPendingAction(deleteKey, () => handlers.onDelete(server.id))
    }
  }, [deleteKey, dom, handlers, server.id, server.name])

  const onToggleEnabled = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked
    runPendingAction(setEnabledKey, () => handlers.onSetEnabled(server.id, enabled))
  }, [handlers, server.id, setEnabledKey])

  const onTestClick = useCallback(() => {
    runPendingAction(testKey, onTest)
  }, [onTest, testKey])

  return (
    <li className="flex items-center gap-3 px-4 py-3" aria-busy={deletePending || undefined}>
      <div className="flex flex-col">
        <span className="font-medium">{server.name}</span>
        <span className="text-xs text-muted-foreground">
          <TransportBadge transport={server.transport} />
          <span className="ml-2">
            {server.transport === "stdio" ? server.command : server.url}
          </span>
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <TestPill result={server.lastTest} pending={testing} />
        {server.transport !== "stdio" && <OAuthPill oauth={server.oauth} />}
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          {setEnabledPending ? <Spinner /> : null}
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={setEnabledPending}
            aria-busy={setEnabledPending || undefined}
            onChange={onToggleEnabled}
            aria-label="Enabled"
          />
          <span>On</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTestClick}
          disabled={testing}
          aria-busy={testing || undefined}
          title="Test connection"
        >
          <RefreshCw className={cn("h-4 w-4", testing && "animate-spin")} />
        </Button>
        <SettingsRowActions label={server.name} onEdit={onEdit} onDelete={onDelete} deletePending={deletePending} />
      </div>
    </li>
  )
}

function TransportBadge({ transport }: { transport: McpServerTransport }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{transport}</span>
  )
}

function TestPill({ result, pending }: { result: McpServerTestResult; pending: boolean }) {
  if (pending || result.status === "pending") {
    return <span className="text-xs text-muted-foreground">Testing…</span>
  }
  switch (result.status) {
    case "ok":
      return (
        <span className="text-xs text-green-600">
          OK · {result.toolCount} tools
        </span>
      )
    case "error":
      return (
        <HoverHint label={result.message}>
          <span className="text-xs text-red-600">
            Failed
          </span>
        </HoverHint>
      )
    case "untested":
    default:
      return <span className="text-xs text-muted-foreground">Untested</span>
  }
}

export function OAuthPill({ oauth }: { oauth: McpOAuthState | undefined }) {
  if (!oauth?.enabled) return null
  switch (oauth.status) {
    case "authenticated":
      return <span className="text-xs text-green-600">OAuth ✓</span>
    case "error":
      return (
        <HoverHint label={oauth.errorMessage}>
          <span className="text-xs text-red-600">
            OAuth error
          </span>
        </HoverHint>
      )
    default:
      return <span className="text-xs text-muted-foreground">OAuth: unauth</span>
  }
}
