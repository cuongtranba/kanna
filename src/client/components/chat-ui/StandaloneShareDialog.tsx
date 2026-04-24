import { Check, Copy, ExternalLink, Globe } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogGhostButton,
  DialogHeader,
  DialogPrimaryButton,
  DialogTitle,
} from "../ui/dialog"

interface Props {
  open: boolean
  shareUrl: string
  onOpenChange: (open: boolean) => void
  onOpenLink: () => void
  onCopyLink: () => Promise<boolean>
}

export function StandaloneShareDialog({
  open,
  shareUrl,
  onOpenChange,
  onOpenLink,
  onCopyLink,
}: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setCopied(false)
    }
  }, [open, shareUrl])

  const handleCopyLink = async () => {
    const didCopy = await onCopyLink()
    if (!didCopy) {
      return
    }

    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share ready</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="flex w-full items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
          >
            <Globe className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{shareUrl}</span>
            <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        </DialogBody>
        <DialogFooter>
          <DialogPrimaryButton type="button" onClick={onOpenLink}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Link
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
