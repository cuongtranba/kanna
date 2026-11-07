import { useCallback } from "react"
import { Link } from "react-router-dom"
import { Button } from "../components/ui/button"
import { INBOX_QUICK_FILTERS, type InboxEmptyReason, type InboxQuickFilter, type InboxTabId } from "../lib/inboxFilter"
import { useInboxStore } from "../stores/inboxStore"

const SKELETON_ROWS = [0, 1, 2, 3, 4]

function InboxListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading inbox">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-start gap-2.5 px-4 py-3">
          <span className="mt-[14px] h-2 w-2 shrink-0" />
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3.5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="h-3 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </span>
        </div>
      ))}
    </div>
  )
}

function NoThreads() {
  return (
    <div className="px-4 py-10 text-sm text-muted-foreground">
      <p>Nothing needs you. Webhooks and MCP sources land here.</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Link to="/webhooks" className="text-foreground underline-offset-4 hover:underline">
          Set up a webhook
        </Link>
        <Link to="/settings/mcp-servers" className="text-foreground underline-offset-4 hover:underline">
          Connect an MCP source
        </Link>
      </p>
    </div>
  )
}

function NoSearchMatches({ query }: { query: string }) {
  const handleClear = useCallback(() => useInboxStore.getState().clearSearch(), [])
  return (
    <div className="space-y-3 px-4 py-10 text-sm text-muted-foreground">
      <p>
        No messages match <span className="break-all text-foreground">&ldquo;{query.trim()}&rdquo;</span>.
      </p>
      <Button variant="secondary" size="sm" onClick={handleClear}>
        Clear search
      </Button>
    </div>
  )
}

function NoQuickMatches({ quick }: { quick: InboxQuickFilter }) {
  const label = INBOX_QUICK_FILTERS.find((entry) => entry.id === quick)?.label ?? quick
  const handleShowAll = useCallback(() => useInboxStore.getState().setQuickFilter("all"), [])
  return (
    <div className="space-y-3 px-4 py-10 text-sm text-muted-foreground">
      <p>Nothing under {label} right now.</p>
      <Button variant="secondary" size="sm" onClick={handleShowAll}>
        Show all
      </Button>
    </div>
  )
}

interface Props {
  reason: InboxEmptyReason
  tab: InboxTabId
  quick: InboxQuickFilter
  query: string
}

export function InboxEmptyList({ reason, tab, quick, query }: Props) {
  if (reason === "loading") return <InboxListSkeleton />
  if (reason === "search") return <NoSearchMatches query={query} />
  if (reason === "quick") return <NoQuickMatches quick={quick} />
  if (tab === "inbox") return <NoThreads />
  return <p className="px-4 py-10 text-sm text-muted-foreground">No activity matches this view yet.</p>
}
