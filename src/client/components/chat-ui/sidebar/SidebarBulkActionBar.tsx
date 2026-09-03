import { Trash2 } from "lucide-react"

interface Props {
  selectedCount: number
  visibleChatCount: number
  onSelectAll: () => void
  onDelete: () => void
}

export function SidebarBulkActionBar({ selectedCount, visibleChatCount, onSelectAll, onDelete }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-border/50 shrink-0">
      <button
        type="button"
        onClick={onSelectAll}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
      >
        {selectedCount === visibleChatCount ? "Deselect all" : "Select all"}
      </button>
      <div className="flex items-center gap-1.5">
        {selectedCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{selectedCount} selected</span>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 bg-transparent px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40 transition-colors duration-150"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete
        </button>
      </div>
    </div>
  )
}
