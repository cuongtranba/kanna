import { useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { errorMessage } from "../../shared/errors"
import { clipboardAdapter } from "../adapters/clipboard.adapter"
import { Button } from "../components/ui/button"
import { HoverHint } from "../components/ui/truncated-text"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useWebhooksStore } from "../stores/webhooksStore"

interface Props {
  copyId: string
  text: string
  label: string
}

async function copyToClipboard(copyId: string, text: string): Promise<void> {
  try {
    await clipboardAdapter.writeText(text)
    useWebhooksStore.getState().markCopied(copyId)
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    throw error
  }
}

export function WebhookCopyButton({ copyId, text, label }: Props) {
  const key = pendingActionKey("webhooks.copy", copyId)
  const pending = usePendingAction(key)
  const copied = useWebhooksStore((state) => state.copiedId === copyId)
  const handleCopy = useCallback(() => {
    runPendingAction(key, () => copyToClipboard(copyId, text))
  }, [copyId, key, text])
  return (
    <HoverHint label={label} side="top">
      <Button variant="ghost" size="icon-sm" aria-label={label} pending={pending} onClick={handleCopy}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
    </HoverHint>
  )
}
