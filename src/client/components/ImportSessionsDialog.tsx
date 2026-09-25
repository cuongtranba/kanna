import { useEffect, useMemo } from "react"
import { extractSessionIds } from "../../shared/claude-session-id"
import { useImportSessionsDialogStore, useImportSessionsDialogText } from "../stores/importSessionsDialogStore"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogBody, DialogTitle, DialogFooter } from "./ui/dialog"
import { Textarea } from "./ui/textarea"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { IMPORT_ALL_SESSIONS_KEY, IMPORT_SESSION_IDS_KEY } from "./chat-ui/sidebar/sidebarPendingActions"

export interface ImportSessionsDialogProps {
  open: boolean
  busy: boolean
  onClose: () => void
  onImportAll: () => Promise<void>
  onImportSessions: (sessionIds: string[]) => Promise<void>
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
  const importingAll = usePendingAction(IMPORT_ALL_SESSIONS_KEY)
  const importingIds = usePendingAction(IMPORT_SESSION_IDS_KEY)

  useEffect(() => {
    if (open) resetForOpen()
  }, [open, resetForOpen])

  const ids = useMemo(() => extractSessionIds(text), [text])
  const hasText = text.trim().length > 0
  const invalid = hasText && ids.length === 0

  const handleImportSessions = () => {
    if (ids.length === 0 || busy) return
    runPendingAction(IMPORT_SESSION_IDS_KEY, () => onImportSessions(ids))
  }

  const handleImportAll = () => {
    if (busy) return
    runPendingAction(IMPORT_ALL_SESSIONS_KEY, onImportAll)
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
          <Button variant="ghost" size="sm" onClick={handleImportAll} disabled={busy} pending={importingAll}>
            Import all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImportSessions}
            disabled={ids.length === 0 || busy}
            pending={importingIds}
          >
            Import {ids.length === 1 ? "session" : "sessions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
