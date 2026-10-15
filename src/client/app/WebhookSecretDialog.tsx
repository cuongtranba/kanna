import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { bearerCurlSample, hmacCurlSample, webhookUrl } from "../lib/webhookPresentation"
import { useWebhooksStore } from "../stores/webhooksStore"
import { WebhookCopyButton } from "./WebhookCopyButton"

function Sample({ copyId, title, text }: { copyId: string; title: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <WebhookCopyButton copyId={copyId} text={text} label={`Copy ${title} command`} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground">{text}</pre>
    </div>
  )
}

export function WebhookSecretDialog({ origin }: { origin: string }) {
  const reveal = useWebhooksStore((state) => state.secretReveal)
  const dismiss = useWebhooksStore((state) => state.dismissSecret)
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) dismiss()
  }, [dismiss])
  if (!reveal) return null
  const url = webhookUrl(origin, reveal.hookId)
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>Secret for {reveal.hookName}</DialogTitle>
          <DialogDescription>
            This is the only time the secret is shown. Copy it now. Rotating it later issues a new one.
          </DialogDescription>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{reveal.secret}</code>
            <WebhookCopyButton copyId={`${reveal.hookId}-secret`} text={reveal.secret} label="Copy secret" />
          </div>
          <Sample copyId={`${reveal.hookId}-bearer`} title="Bearer token" text={bearerCurlSample(url, reveal.secret)} />
          <Sample copyId={`${reveal.hookId}-hmac`} title="HMAC signature" text={hmacCurlSample(url, reveal.secret)} />
        </DialogBody>
        <DialogFooter>
          <Button size="sm" onClick={dismiss}>
            I have copied it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
