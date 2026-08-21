import { useCallback } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { ColorChoice } from "./ColorChoice"
import { useColumnSettingsStore } from "./ColumnSettings.store"
import {
  COLUMN_COLOR_TOKENS,
  type ColumnColorToken,
  type ColumnSemantic,
} from "../../../shared/boards/types"

/**
 * Editing one column.
 *
 * A popover on the column header rather than a settings screen: the thing being
 * renamed is right there, and a board's columns are edited while looking at the
 * board.
 *
 * `semantic` is offered as a labelled choice, not as jargon, because it is
 * load-bearing — "Start work" moves cards to the `active` column and sync
 * routes pulled issues by `start` / `done`, so the copy says what each role
 * DOES rather than naming the enum.
 */

export interface ColumnSettingsValue {
  title: string
  semantic: ColumnSemantic | null
  colorToken: ColumnColorToken | null
  wipLimit: number | null
}

export interface ColumnSettingsProps {
  columnId: string
  value: ColumnSettingsValue
  /** Empty columns only; the store refuses while cards remain. */
  canDelete: boolean
  onSave: (columnId: string, patch: ColumnSettingsValue) => void
  onDelete: (columnId: string) => void
}

const SEMANTICS: { value: ColumnSemantic | ""; label: string; hint: string }[] = [
  { value: "", label: "No role", hint: "Nothing routes here automatically." },
  { value: "start", label: "Incoming", hint: "Pulled issues land here." },
  { value: "active", label: "In progress", hint: "Start work moves a card here." },
  { value: "review", label: "In review", hint: "No automatic behaviour yet." },
  { value: "done", label: "Done", hint: "Closes the issue, and asks about the worktree." },
]

export function ColumnSettings({ columnId, value, canDelete, onSave, onDelete }: ColumnSettingsProps) {
  const open = useColumnSettingsStore((state) => state.openColumnId === columnId)
  const draft = useColumnSettingsStore((state) => state.draft)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      const store = useColumnSettingsStore.getState()
      if (next) store.open(columnId, value)
      else store.close()
    },
    [columnId, value],
  )

  const handleTitle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useColumnSettingsStore.getState().setTitle(event.currentTarget.value)
  }, [])

  const handleWipLimit = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useColumnSettingsStore.getState().setWipLimit(event.currentTarget.value)
  }, [])

  const handleSemantic = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    useColumnSettingsStore.getState().setSemantic(event.currentTarget.value)
  }, [])

  const handleColor = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    useColumnSettingsStore.getState().setColorToken(event.currentTarget.value)
  }, [])

  const handleSave = useCallback(() => {
    const state = useColumnSettingsStore.getState()
    if (state.draft.title.trim() === "") return
    onSave(columnId, { ...state.draft, title: state.draft.title.trim() })
    state.close()
  }, [columnId, onSave])

  const handleDelete = useCallback(() => {
    onDelete(columnId)
    useColumnSettingsStore.getState().close()
  }, [columnId, onDelete])

  const hint = SEMANTICS.find((entry) => (entry.value === "" ? null : entry.value) === draft.semantic)?.hint

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Column settings: ${value.title}`}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`column-title-${columnId}`}>
            Name
          </label>
          <Input id={`column-title-${columnId}`} value={draft.title} onChange={handleTitle} />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`column-role-${columnId}`}>
            Role
          </label>
          <select
            id={`column-role-${columnId}`}
            value={draft.semantic ?? ""}
            onChange={handleSemantic}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-13 text-foreground"
          >
            {SEMANTICS.map((entry) => (
              <option key={entry.label} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          {hint ? <p className="text-13 text-muted-foreground">{hint}</p> : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Dot</p>
          <div className="flex items-center gap-1.5">
            <ColorChoice token={null} label="No dot" selected={draft.colorToken === null} onSelect={handleColor} />
            {COLUMN_COLOR_TOKENS.map((token) => (
              <ColorChoice
                key={token}
                token={token}
                label={token}
                selected={draft.colorToken === token}
                onSelect={handleColor}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`column-wip-${columnId}`}>
            WIP limit
          </label>
          <Input
            id={`column-wip-${columnId}`}
            value={draft.wipLimit === null ? "" : String(draft.wipLimit)}
            onChange={handleWipLimit}
            inputMode="numeric"
            placeholder="None"
            className="tabular-nums"
          />
          <p className="text-13 text-muted-foreground">Advisory. Going over is shown, never blocked.</p>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={handleSave} disabled={draft.title.trim() === ""}>
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive-text"
            onClick={handleDelete}
            disabled={!canDelete}
          >
            Delete
          </Button>
        </div>
        {canDelete ? null : (
          <p className="text-13 text-muted-foreground">Move or archive its cards before deleting it.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
