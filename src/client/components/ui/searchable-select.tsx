import { useCallback, useId, useMemo, type ChangeEvent, type KeyboardEvent } from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import { cn } from "../../lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { SearchableSelectStore } from "./searchable-select.store"

export interface SearchableOption {
  value: string
  label: string
  hint?: string
  group?: string
}

export function filterSearchableOptions(
  options: readonly SearchableOption[],
  query: string,
): readonly SearchableOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      (option.hint?.toLowerCase().includes(needle) ?? false) ||
      (option.group?.toLowerCase().includes(needle) ?? false),
  )
}

interface Props {
  id?: string
  value: string
  options: readonly SearchableOption[]
  placeholder: string
  searchPlaceholder?: string
  emptyMessage?: string
  onValueChange: (value: string) => void
}

interface OptionRowProps {
  option: SearchableOption
  optionId: string
  active: boolean
  selected: boolean
  onPick: (value: string) => void
}

function scrollIntoNearest(node: HTMLButtonElement | null) {
  node?.scrollIntoView({ block: "nearest" })
}

function OptionRow({ option, optionId, active, selected, onPick }: OptionRowProps) {
  const handleClick = useCallback(() => onPick(option.value), [onPick, option.value])
  return (
    <button
      ref={active ? scrollIntoNearest : undefined}
      id={optionId}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={handleClick}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors",
        active ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.hint ? <span className="block truncate text-xs text-muted-foreground">{option.hint}</span> : null}
      </span>
    </button>
  )
}

function SearchableSelectContent({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder = "Search...",
  emptyMessage = "Nothing to choose from",
  onValueChange,
}: Props) {
  const listboxId = useId()
  const open = SearchableSelectStore.useScopedStore((state) => state.open)
  const query = SearchableSelectStore.useScopedStore((state) => state.query)
  const activeIndex = SearchableSelectStore.useScopedStore((state) => state.activeIndex)
  const setOpen = SearchableSelectStore.useScopedStore((state) => state.setOpen)
  const setQuery = SearchableSelectStore.useScopedStore((state) => state.setQuery)
  const moveActive = SearchableSelectStore.useScopedStore((state) => state.moveActive)
  const close = SearchableSelectStore.useScopedStore((state) => state.close)

  const filtered = useMemo(() => filterSearchableOptions(options, query), [options, query])
  const selected = options.find((option) => option.value === value)
  const activeOption = filtered[Math.min(activeIndex, filtered.length - 1)]
  const optionId = (option: SearchableOption) => `${listboxId}-${option.value}`

  const handlePick = useCallback(
    (picked: string) => {
      onValueChange(picked)
      close()
    },
    [close, onValueChange],
  )
  const handleQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value), [setQuery])
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        moveActive(1, filtered.length)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        moveActive(-1, filtered.length)
      } else if (event.key === "Enter" && activeOption) {
        event.preventDefault()
        handlePick(activeOption.value)
      }
    },
    [activeOption, filtered.length, handlePick, moveActive],
  )

  const rows = filtered.map((option, index) => {
    const heading = option.group && option.group !== filtered[index - 1]?.group ? option.group : null
    return (
      <div key={option.value}>
        {heading ? <div className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">{heading}</div> : null}
        <OptionRow
          option={option}
          optionId={optionId(option)}
          active={option === activeOption}
          selected={option.value === value}
          onPick={handlePick}
        />
      </div>
    )
  })

  let body = <div role="listbox" id={listboxId} className="max-h-72 overflow-y-auto py-1">{rows}</div>
  if (options.length === 0) {
    body = <div className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyMessage}</div>
  } else if (filtered.length === 0) {
    body = <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</div>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-1">
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-label={searchPlaceholder}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            autoFocus
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {body}
      </PopoverContent>
    </Popover>
  )
}

export function SearchableSelect(props: Props) {
  return (
    <SearchableSelectStore.Provider init={undefined}>
      <SearchableSelectContent {...props} />
    </SearchableSelectStore.Provider>
  )
}
