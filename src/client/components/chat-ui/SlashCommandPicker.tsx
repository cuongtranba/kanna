import { useEffect, useRef } from "react"
import type { SlashCommand } from "../../../shared/types"
import { cn } from "../../lib/utils"

interface SlashCommandPickerProps {
  items: SlashCommand[]
  activeIndex: number
  loading: boolean
  onSelect: (command: SlashCommand) => void
  onHoverIndex: (index: number) => void
}

const SKELETON_ROWS = 4

export function SlashCommandPicker({ items, activeIndex, loading, onSelect, onHoverIndex }: SlashCommandPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = listRef.current?.children.item(activeIndex) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (items.length === 0 && loading) {
    return (
      <ul
        aria-busy="true"
        aria-label="Loading slash commands"
        className="absolute bottom-full left-0 mb-2 w-full max-w-md rounded-md border border-border bg-popover shadow-md overflow-hidden"
      >
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2 px-3 py-1.5"
            data-testid="slash-picker-skeleton-row"
          >
            <span className="h-3 w-20 rounded bg-muted animate-pulse" />
            <span className="h-3 w-12 rounded bg-muted/70 animate-pulse" />
            <span className="ml-auto h-3 w-32 rounded bg-muted/60 animate-pulse" />
          </li>
        ))}
      </ul>
    )
  }

  if (items.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 w-full max-w-md rounded-md border border-border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No matching commands
      </div>
    )
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-full max-w-md max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
    >
      {items.map((cmd, i) => (
        <li
          key={cmd.name}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(cmd)
          }}
          onMouseEnter={() => onHoverIndex(i)}
          className={cn(
            "flex items-baseline gap-2 px-3 py-1.5 cursor-pointer text-sm",
            i === activeIndex && "bg-accent text-accent-foreground",
          )}
        >
          <span className="font-mono">/{cmd.name}</span>
          {cmd.argumentHint && (
            <span className="text-muted-foreground font-mono text-xs">{cmd.argumentHint}</span>
          )}
          {cmd.description && (
            <span className="ml-auto text-muted-foreground text-xs truncate">{cmd.description}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
