import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
          <DialogTitle>Shared Link</DialogTitle>
          <DialogDescription>Shared links are snapshots in time and contain all attachments, tool calls and history. Be mindful of sensitive info.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-muted/40 pl-4 px-3 py-2.5">
            {/* <Globe className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> */}
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{shareUrl}</span>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              title={copied ? "Copied" : "Copy link"}
              aria-label={copied ? "Copied" : "Copy link"}
              className="flex flex-shrink-0 items-center justify-center rounded-lg text-logo hover:text-logo/60 transition-colors hover:bg-background hover:text-foreground"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogPrimaryButton type="button" onClick={onOpenLink}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
