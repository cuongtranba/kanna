
import type { ReactNode } from "react"
import type { StackSummary } from "../../../../shared/types"
import { runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import { Spinner } from "../../ui/spinner"
import { StackCreatePanel } from "./StackCreatePanel"
import { removeStackKey } from "./sidebarPendingActions"

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
  editId: string | null
  deleteConfirmId: string | null
  onSubmit: (title: string, projectIds: string[], instructions: string) => Promise<void>
  onCancel: () => void
  onConfirmDelete: (stackId: string) => Promise<void>
  onCancelDelete: () => void
}): ReactNode {
  const editing = editId ? stacks.find((s) => s.id === editId) : undefined
  const deleting = deleteConfirmId ? stacks.find((s) => s.id === deleteConfirmId) : undefined
  const deletePending = usePendingAction(removeStackKey(deleteConfirmId ?? ""))

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
              disabled={deletePending}
              aria-busy={deletePending || undefined}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-70"
              onClick={() => runPendingAction(removeStackKey(deleting.id), () => onConfirmDelete(deleting.id))}
            >
              {deletePending ? <Spinner /> : null}
              Delete
            </button>
            <button
              type="button"
              disabled={deletePending}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
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
