import { useCallback, useMemo } from "react"
import { Copy, Link2Off } from "lucide-react"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import type { ShareSummary } from "../../../shared/session-share/types"
import type { ClipboardPort } from "../../ports/clipboardPort"
import { clipboardAdapter } from "../../adapters/clipboard.adapter"
import { SharePopoverBodyStore } from "./SharePopoverBody.store"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import { errorMessage } from "../../../shared/errors"

export interface SharePopoverProps {
  chatId: string
  shares: readonly ShareSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  onMint: (chatId: string) => Promise<void>
  onRevoke: (tokenId: string) => Promise<void>
}

function relativeExpiry(expiresAt: number, now: number): string {
  const ms = expiresAt - now
  if (ms <= 0) return "Expired"
  const h = Math.round(ms / 3_600_000)
  if (h < 1) return "Expires in <1h"
  if (h < 48) return `Expires in ${h}h`
  return `Expires in ${Math.round(h / 24)}d`
}

export interface SharePopoverBodyProps {
  chatId: string
  shares: readonly ShareSummary[]
  now: number
  onMint: (chatId: string) => Promise<void>
  onRevoke: (tokenId: string) => Promise<void>
  clipboard?: ClipboardPort
}

function SharePopoverBodyInner(props: SharePopoverBodyProps) {
  const clipboard = props.clipboard ?? clipboardAdapter
  const error = SharePopoverBodyStore.useScopedStore((s) => s.error)
  const setError = SharePopoverBodyStore.useScopedStore((s) => s.setError)
  const activeShares = props.shares.filter((s) => !s.revoked)

  const { onMint, chatId } = props
  const mintKey = pendingActionKey("share.mint", chatId)
  const minting = usePendingAction(mintKey)

  const handleMint = useCallback(() => {
    runPendingAction(mintKey, async () => {
      try {
        await onMint(chatId)
        setError(null)
      } catch (cause) {
        setError(`Couldn't create a share link: ${errorMessage(cause)}`)
      }
    })
  }, [mintKey, onMint, chatId, setError])

  return (
    <>
      <Button
        variant="default"
        pending={minting}
        data-share-mint=""
        onClick={handleMint}
      >
        {minting ? "Creating…" : "Create share link"}
      </Button>
      {error ? <p role="alert" className="text-xs text-destructive-text">{error}</p> : null}
      {activeShares.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active share links for this chat.</p>
      ) : (
        <ul className="space-y-2">
          {activeShares.map((s) => (
            <ShareRow
              key={s.tokenId}
              share={s}
              now={props.now}
              clipboard={clipboard}
              onRevoke={props.onRevoke}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function ShareRow({
  share,
  now,
  clipboard,
  onRevoke,
}: {
  share: ShareSummary
  now: number
  clipboard: ClipboardPort
  onRevoke: (tokenId: string) => Promise<void>
}) {
  const setError = SharePopoverBodyStore.useScopedStore((s) => s.setError)
  const markCopied = SharePopoverBodyStore.useScopedStore((s) => s.markCopied)
  const copied = SharePopoverBodyStore.useScopedStore((s) => s.copiedTokenId === share.tokenId)
  const copyKey = pendingActionKey("share.copy", share.tokenId)
  const revokeKey = pendingActionKey("share.revoke", share.tokenId)
  const copying = usePendingAction(copyKey)
  const revoking = usePendingAction(revokeKey)
  const { tokenId, url } = share

  const handleCopy = useCallback(() => {
    runPendingAction(copyKey, async () => {
      try {
        await clipboard.writeText(url)
        markCopied(tokenId)
      } catch (cause) {
        setError(`Couldn't copy the link: ${errorMessage(cause)}`)
      }
    })
  }, [clipboard, copyKey, markCopied, setError, tokenId, url])

  const handleRevoke = useCallback(() => {
    runPendingAction(revokeKey, async () => {
      try {
        await onRevoke(tokenId)
        setError(null)
      } catch (cause) {
        setError(`Couldn't revoke the link: ${errorMessage(cause)}`)
      }
    })
  }, [onRevoke, revokeKey, setError, tokenId])

  return (
    <li className="flex flex-col gap-1 rounded border border-border/40 p-2 text-xs">
      <code className="break-all">{url}</code>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" pending={copying} onClick={handleCopy}>
          {copying ? null : <Copy className="h-3.5 w-3.5 mr-1" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-share-revoke=""
          pending={revoking}
          onClick={handleRevoke}
        >
          {revoking ? null : <Link2Off className="h-3.5 w-3.5 mr-1" />}
          {revoking ? "Revoking…" : "Revoke"}
        </Button>
        <span className="ml-auto text-muted-foreground">{relativeExpiry(share.expiresAt, now)}</span>
      </div>
    </li>
  )
}

export function SharePopoverBody(props: SharePopoverBodyProps) {
  return (
    <SharePopoverBodyStore.Provider init={undefined}>
      <SharePopoverBodyInner {...props} />
    </SharePopoverBodyStore.Provider>
  )
}

export function SharePopover(props: SharePopoverProps) {
  // eslint-disable-next-line react-hooks/purity
  const now = useMemo(() => Date.now(), [props.open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tooltip>
      <Popover open={props.open} onOpenChange={props.onOpenChange}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent align="end" className="w-96 p-4 space-y-3">
          <SharePopoverBody
            chatId={props.chatId}
            shares={props.shares}
            now={now}
            onMint={props.onMint}
            onRevoke={props.onRevoke}
          />
        </PopoverContent>
      </Popover>
      <TooltipContent side="bottom">Mint a public read-only link</TooltipContent>
    </Tooltip>
  )
}
