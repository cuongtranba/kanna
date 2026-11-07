import { useCallback, useEffect, useRef } from "react"
import { Search, X } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { selectSearchQuery, useInboxStore } from "../stores/inboxStore"

export function InboxSearchBox() {
  const query = useInboxStore(selectSearchQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () => useInboxStore.getState().registerSearchFocus(() => inputRef.current?.focus()),
    [],
  )

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useInboxStore.getState().setSearchQuery(event.target.value)
  }, [])
  const handleClear = useCallback(() => {
    useInboxStore.getState().clearSearch()
    inputRef.current?.focus()
  }, [])
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      if (query.length > 0) useInboxStore.getState().clearSearch()
      else inputRef.current?.blur()
    },
    [query],
  )

  return (
    <div className="relative min-w-40 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={inputRef}
        type="text"
        aria-label="Search inbox"
        placeholder="Search"
        autoComplete="off"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="h-9 pl-8 pr-8"
      />
      {query.length > 0 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2"
          onClick={handleClear}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
