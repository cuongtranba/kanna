import { useCallback } from "react"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"
import { useBoardFilterStore, selectBoardFilter } from "./BoardFilter.store"

interface InboxFilterBarProps {
  boardId: string
}

export function InboxFilterBar({ boardId }: InboxFilterBarProps) {
  const filter = useBoardFilterStore(selectBoardFilter(boardId))

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      useBoardFilterStore.getState().setText(boardId, event.currentTarget.value)
    },
    [boardId],
  )

  const handleClear = useCallback(() => {
    useBoardFilterStore.getState().clear(boardId)
  }, [boardId])

  const hasFilter = filter.text.length > 0 || filter.labels.length > 0

  return (
    <div className="flex items-center gap-1 px-1 pb-1.5">
      <input
        value={filter.text}
        onChange={handleChange}
        placeholder="Filter…"
        aria-label="Filter cards"
        className={cn(
          "min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-xs text-foreground",
          "placeholder:text-muted-foreground hover:bg-secondary focus:bg-secondary focus:outline-none",
        )}
      />
      {hasFilter ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear filter"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
