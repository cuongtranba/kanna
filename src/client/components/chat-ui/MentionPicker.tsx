import { useEffect, useRef } from "react"
import { AtSign, Folder, FileText } from "lucide-react"
import type { ProjectPath } from "../../hooks/useMentionSuggestions"
import { cn } from "../../lib/utils"

interface MentionPickerProps {
  items: ProjectPath[]
  activeIndex: number
  loading: boolean
  onSelect: (path: ProjectPath) => void
  onHoverIndex: (index: number) => void
}

const SKELETON_ROWS = 4

export function MentionPicker({ items, activeIndex, loading, onSelect, onHoverIndex }: MentionPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = listRef.current?.children.item(activeIndex) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (items.length === 0 && loading) {
    return (
      <ul
        aria-busy="true"
        aria-label="Loading file suggestions"
        className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl rounded-md border border-border bg-popover shadow-md overflow-hidden"
      >
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-2 px-3 py-1.5"
            data-testid="mention-picker-skeleton-row"
          >
            <span className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <span className="h-3 w-40 max-w-full rounded bg-muted animate-pulse" />
          </li>
        ))}
      </ul>
    )
  }

  if (items.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl rounded-md border border-border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No matching files
      </div>
    )
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
    >
      {items.map((item, i) => {
        const Icon = item.kind === "dir" ? Folder : FileText
        return (
          <li
            key={`${item.kind}:${item.path}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(item)
            }}
            onMouseEnter={() => onHoverIndex(i)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
          >
            <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono truncate">{item.path}</span>
          </li>
        )
      })}
    </ul>
  )
}
