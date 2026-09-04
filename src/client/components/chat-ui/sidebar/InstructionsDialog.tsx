/**
 * Edit a project's or a stack's instructions.
 *
 * One component for both because they are the same edit with a different
 * heading — the server caps both at `GLOBAL_PROMPT_APPEND_MAX_CHARS` and
 * treats blank as a clear, so a second dialog would only be a second place to
 * get the counter wrong.
 *
 * Deliberately not `useAppDialog().prompt`: that is a single-line input and
 * coerces an emptied value to `null`, which would make clearing impossible.
 */

import { useCallback, type ReactNode } from "react"
import { createScopedStore } from "../../../lib/createScopedStore"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogGhostButton,
  DialogHeader,
  DialogPrimaryButton,
  DialogTitle,
} from "../../ui/dialog"
import { Textarea } from "../../ui/textarea"
import { GLOBAL_PROMPT_APPEND_MAX_CHARS } from "../../../../shared/app-settings-types"
import { cn } from "../../../lib/utils"

interface InstructionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names what the instructions are FOR, e.g. the project or stack title. */
  title: string
  description: string
  initialValue: string
  onSave: (instructions: string) => void
}

interface DraftState {
  value: string
  setValue: (value: string) => void
}

/**
 * The draft lives in a scoped store, not `useState` — `useState` is banned in
 * `src/client`. Scoped rather than global because two dialogs must never share
 * a draft, and the store is created per Provider mount.
 */
const draftStore = createScopedStore<{ initialValue: string }, DraftState>(
  "InstructionsDialogDraft",
  (init) => (set) => ({
    value: init.initialValue,
    setValue: (value) => set({ value }),
  }),
)

function InstructionsDialogInner({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  onSave,
}: InstructionsDialogProps): ReactNode {
  const value = draftStore.useScopedStore((s) => s.value)
  const setValue = draftStore.useScopedStore((s) => s.setValue)
  const overCap = value.length > GLOBAL_PROMPT_APPEND_MAX_CHARS

  const handleOpenChange = useCallback((next: boolean) => {
    // Re-seed from the persisted value on every open, so a cancelled edit is
    // not still sitting in the box the next time the dialog is opened.
    if (next) setValue(initialValue)
    onOpenChange(next)
  }, [initialValue, onOpenChange, setValue])

  const handleSave = useCallback(() => {
    if (value.length > GLOBAL_PROMPT_APPEND_MAX_CHARS) return
    onSave(value.trim())
    onOpenChange(false)
  }, [onOpenChange, onSave, value])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instructions — {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea
            aria-label={`Instructions for ${title}`}
            className="min-h-40 font-mono"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. never edit generated/ by hand; run pnpm gen after schema changes"
          />
          <p className={cn(
            "mt-1.5 text-right text-xs tabular-nums",
            overCap ? "text-destructive" : "text-muted-foreground",
          )}>
            {value.length} / {GLOBAL_PROMPT_APPEND_MAX_CHARS}
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogGhostButton onClick={() => handleOpenChange(false)}>Cancel</DialogGhostButton>
          <DialogPrimaryButton onClick={handleSave} disabled={overCap}>Save</DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function InstructionsDialog(props: InstructionsDialogProps): ReactNode {
  return (
    // Keyed on the persisted value so a project whose instructions changed
    // elsewhere gets a store seeded from the new text, not the stale draft.
    <draftStore.Provider init={{ initialValue: props.initialValue }} key={props.initialValue}>
      <InstructionsDialogInner {...props} />
    </draftStore.Provider>
  )
}
