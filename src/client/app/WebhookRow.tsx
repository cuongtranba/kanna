import { useCallback } from "react"
import { Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { ProviderCatalogEntry } from "../../shared/provider-model-types"
import type { WebhookSummary } from "../../shared/webhooks/types"
import { useAppDialog } from "../components/ui/app-dialog"
import { Button } from "../components/ui/button"
import { HoverHint } from "../components/ui/truncated-text"
import { describeLastDelivery, webhookActionLabel, webhookUrl } from "../lib/webhookPresentation"
import { describeWebhookModel, describeWebhookTarget, type WebhookTargets } from "../lib/webhookTargets"
import { cn } from "../lib/utils"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useWebhooksStore } from "../stores/webhooksStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { WebhookCopyButton } from "./WebhookCopyButton"
import { readRevealedSecret, sendWebhookCommand } from "./webhookCommands"

interface Props {
  hook: WebhookSummary
  targets: WebhookTargets
  catalog: readonly ProviderCatalogEntry[]
  origin: string
  divider: boolean
}

export function WebhookRow({ hook, targets, catalog, origin, divider }: Props) {
  const socket = useOptionalKannaSocket()
  const dialog = useAppDialog()
  const url = webhookUrl(origin, hook.id)
  const toggleKey = pendingActionKey("webhooks.update", hook.id)
  const rotateKey = pendingActionKey("webhooks.rotateSecret", hook.id)
  const deleteKey = pendingActionKey("webhooks.delete", hook.id)
  const togglePending = usePendingAction(toggleKey)
  const rotatePending = usePendingAction(rotateKey)
  const deletePending = usePendingAction(deleteKey)

  const openEdit = useWebhooksStore((state) => state.openEdit)
  const handleEdit = useCallback(() => openEdit(hook.id), [hook.id, openEdit])
  const modelLabel = describeWebhookModel(hook, catalog)
  const targetLine = modelLabel ? `${describeWebhookTarget(hook, targets)} · ${modelLabel}` : describeWebhookTarget(hook, targets)

  const handleToggle = useCallback(() => {
    runPendingAction(toggleKey, async () => {
      await sendWebhookCommand(socket, { type: "webhooks.update", id: hook.id, patch: { enabled: !hook.enabled } })
    })
  }, [hook.enabled, hook.id, socket, toggleKey])

  const handleRotate = useCallback(() => {
    runPendingAction(rotateKey, async () => {
      const confirmed = await dialog.confirm({
        title: `Rotate the secret for ${hook.name}?`,
        description: "The current secret stops working immediately. Update every system that calls this webhook.",
        confirmLabel: "Rotate",
      })
      if (!confirmed) return
      const result = await sendWebhookCommand(socket, { type: "webhooks.rotateSecret", id: hook.id })
      useWebhooksStore.getState().revealSecret(readRevealedSecret(result, hook.id, hook.name))
    })
  }, [dialog, hook.id, hook.name, rotateKey, socket])

  const handleDelete = useCallback(() => {
    runPendingAction(deleteKey, async () => {
      const confirmed = await dialog.confirm({
        title: `Delete ${hook.name}?`,
        description: "Callers will receive 404. This cannot be undone.",
        confirmLabel: "Delete",
        confirmVariant: "destructive",
      })
      if (!confirmed) return
      await sendWebhookCommand(socket, { type: "webhooks.delete", id: hook.id })
    })
  }, [deleteKey, dialog, hook.id, hook.name, socket])

  return (
    <div className={cn("flex items-start gap-3 bg-background px-4 py-3", divider && "border-b border-border")}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{hook.name}</span>
          <span className="text-xs text-muted-foreground">{webhookActionLabel(hook.mode, hook.handling)}</span>
          {hook.enabled ? null : <span className="text-xs font-medium text-muted-foreground">Disabled</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{targetLine}</div>
        <div className="flex items-center gap-1">
          <code className="min-w-0 truncate font-mono text-xs text-foreground">{url}</code>
          <WebhookCopyButton copyId={hook.id} text={url} label="Copy webhook url" />
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          secret ending <span className="font-mono">{hook.secretHint}</span> · {describeLastDelivery(hook.lastDelivery)}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" pending={togglePending} onClick={handleToggle}>
          {hook.enabled ? "Disable" : "Enable"}
        </Button>
        <HoverHint label="Edit webhook" side="top">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${hook.name}`} onClick={handleEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </HoverHint>
        <HoverHint label="Rotate secret" side="top">
          <Button variant="ghost" size="icon-sm" aria-label={`Rotate secret for ${hook.name}`} pending={rotatePending} onClick={handleRotate}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </HoverHint>
        <HoverHint label="Delete webhook" side="top">
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${hook.name}`} pending={deletePending} onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </HoverHint>
      </span>
    </div>
  )
}
