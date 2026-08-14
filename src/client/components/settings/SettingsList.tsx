import type { ReactNode } from "react"
import { Pencil, Trash2, type LucideIcon } from "lucide-react"
import { Button } from "../ui/button"

/** Placeholder shown where a Settings collection has no entries yet. */
export function SettingsEmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed px-6 py-10 text-center">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y rounded-md border">{children}</ul>
}

/**
 * `label` names the entry, not the verb — it becomes the accessible name of both
 * buttons ("Edit fs" / "Delete fs"), which is how a row is addressed in tests.
 */
export function SettingsRowActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${label}`}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${label}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  )
}
