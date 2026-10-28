import { useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { clipboardAdapter } from "../adapters/clipboard.adapter"
import { Button } from "../components/ui/button"
import { HoverHint } from "../components/ui/truncated-text"
import { withCommandFeedback } from "../lib/commandFeedback"
import { copyWithFeedback, useCopied } from "../stores/copyFeedbackStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"

interface Props {
  copyId: string
  text: string
  label: string
}

export function WebhookCopyButton({ copyId, text, label }: Props) {
  const key = pendingActionKey("webhooks.copy", copyId)
  const pending = usePendingAction(key)
  const copied = useCopied(key)
  const handleCopy = useCallback(() => {
    runPendingAction(key, () => withCommandFeedback(() => copyWithFeedback(key, () => clipboardAdapter.writeText(text))))
  }, [key, text])
  return (
    <HoverHint label={label} side="top">
      <Button variant="ghost" size="icon-sm" aria-label={label} pending={pending} onClick={handleCopy}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
    </HoverHint>
  )
}
