import { useCallback, useMemo } from "react"
import { Plus, Webhook } from "lucide-react"
import type { WebhookInput } from "../../shared/webhooks/types"
import { domAdapter } from "../adapters/dom.adapter"
import { Button } from "../components/ui/button"
import { SHELL_PAGE_SCROLL_CLASS } from "../lib/shellChrome"
import { listWebhookTargets } from "../lib/webhookTargets"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { useWebhooksStore } from "../stores/webhooksStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { useProviderCatalog } from "./useProviderCatalog"
import { WebhookCreateDialog } from "./WebhookCreateDialog"
import { WebhookRow } from "./WebhookRow"
import { WebhookSecretDialog } from "./WebhookSecretDialog"
import { readCreatedWebhook, sendWebhookCommand } from "./webhookCommands"

export function WebhooksPage() {
  const socket = useOptionalKannaSocket()
  const hooks = useWebhooksStore((state) => state.hooks)
  const openCreate = useWebhooksStore((state) => state.openCreate)
  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const targets = useMemo(() => listWebhookTargets(sidebarData), [sidebarData])
  const catalog = useProviderCatalog()
  const origin = domAdapter.getOrigin()

  const handleCreate = useCallback(
    async (input: WebhookInput) => {
      const created = await sendWebhookCommand(socket, { type: "webhooks.create", input })
      useWebhooksStore.getState().revealSecret(readCreatedWebhook(created))
    },
    [socket],
  )

  return (
    <div className={SHELL_PAGE_SCROLL_CLASS}>
      <div className="mx-auto w-full max-w-[900px] px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
            <Webhook className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Webhooks
            <span className="text-sm font-normal text-muted-foreground tabular-nums">{hooks.length}</span>
          </h1>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New webhook
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          An outside system POSTs to a webhook url with its secret. Kanna leaves a card in a chat, queues a prompt in a
          chat, or starts a new chat. Webhook urls are reachable wherever Kanna is reachable.
        </p>
        {hooks.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">No webhooks yet. Create one to get a url and a secret.</p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border">
            {hooks.map((hook, index) => (
              <WebhookRow key={hook.id} hook={hook} targets={targets} catalog={catalog} origin={origin} divider={index < hooks.length - 1} />
            ))}
          </div>
        )}
      </div>
      <WebhookCreateDialog sidebarData={sidebarData} onCreate={handleCreate} />
      <WebhookSecretDialog origin={origin} />
    </div>
  )
}
