/**
 * The two transient panels the Stacks section can open below itself: the
 * create/edit form, and the delete confirmation.
 *
 * Extracted from `KannaSidebar.tsx`, which is on its architecture-budget
 * ceiling — the budget's prescribed remedy is a module that owns the code
 * rather than a raised pin. Both panels are inline (not dialogs) so they stay
 * in the sidebar's scroll flow, which is why they live together: they are the
 * same slot, and at most one is open at a time.
 */

import type { ReactNode } from "react"
import type { StackSummary } from "../../../../shared/types"
import { StackCreatePanel } from "./StackCreatePanel"

export function StackEditPanels({
  stacks,
  projects,
  createPanelOpen,
  editId,
  deleteConfirmId,
  onSubmit,
  onCancel,
  onConfirmDelete,
  onCancelDelete,
}: {
  stacks: StackSummary[]
  projects: Array<{ id: string; title: string }>
  createPanelOpen: boolean
  /** Non-null puts the create panel into edit mode against this stack. */
  editId: string | null
  deleteConfirmId: string | null
  onSubmit: (title: string, projectIds: string[], instructions: string) => Promise<void>
  onCancel: () => void
  onConfirmDelete: (stackId: string) => void
  onCancelDelete: () => void
}): ReactNode {
  const editing = editId ? stacks.find((s) => s.id === editId) : undefined
  const deleting = deleteConfirmId ? stacks.find((s) => s.id === deleteConfirmId) : undefined

  return (
    <>
      {createPanelOpen && (
        <StackCreatePanel
          mode={editId ? "edit" : "create"}
          projects={projects}
          initialProjectIds={editing?.projectIds ?? []}
          initialTitle={editing?.title ?? ""}
          initialInstructions={editing?.instructions ?? ""}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}

      {deleting && (
        <div className="px-2.5 py-2 border border-destructive/50 rounded-lg bg-background mx-2 my-1">
          <p className="text-xs text-destructive mb-2">Delete &quot;{deleting.title}&quot;?</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onConfirmDelete(deleting.id)}
            >
              Delete
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
              onClick={onCancelDelete}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
