import { useEffect, useMemo } from "react"
import { extractSessionIds } from "../../shared/claude-session-id"
import { useImportSessionsDialogStore, useImportSessionsDialogText } from "../stores/importSessionsDialogStore"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogBody, DialogTitle, DialogFooter } from "./ui/dialog"
import { Textarea } from "./ui/textarea"

export interface ImportSessionsDialogProps {
  open: boolean
  busy: boolean
  onClose: () => void
  onImportAll: () => void
  onImportSessions: (sessionIds: string[]) => void
}

export function ImportSessionsDialog({
  open,
  busy,
  onClose,
  onImportAll,
  onImportSessions,
}: ImportSessionsDialogProps) {
  const text = useImportSessionsDialogText()
  const setText = useImportSessionsDialogStore((state) => state.setText)
  const resetForOpen = useImportSessionsDialogStore((state) => state.resetForOpen)

  useEffect(() => {
    if (open) resetForOpen()
  }, [open, resetForOpen])

  const ids = useMemo(() => extractSessionIds(text), [text])
  const hasText = text.trim().length > 0
  const invalid = hasText && ids.length === 0

  const handleImportSessions = () => {
    if (ids.length === 0 || busy) return
    onImportSessions(ids)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent size="sm">
        <DialogBody className="space-y-3">
          <DialogTitle>Import Claude sessions</DialogTitle>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste one or more session ids (uuid, filename, or full path)…"
            rows={4}
          />
          {invalid ? (
            <p className="text-xs text-destructive">No valid session id found in the pasted text.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Empty input imports ALL sessions (full scan). Active sessions import as a live view —
            sending a message there takes over the session.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={onImportAll} disabled={busy}>
            Import all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImportSessions}
            disabled={ids.length === 0 || busy}
          >
            Import {ids.length === 1 ? "session" : "sessions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
