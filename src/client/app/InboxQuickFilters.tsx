import { useCallback, useMemo } from "react"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { INBOX_QUICK_FILTERS, type InboxQuickCounts, type InboxQuickFilter } from "../lib/inboxFilter"
import { useInboxStore } from "../stores/inboxStore"

interface Props {
  value: InboxQuickFilter
  counts: InboxQuickCounts
}

export function InboxQuickFilters({ value, counts }: Props) {
  const options = useMemo<SegmentedOption<InboxQuickFilter>[]>(
    () =>
      INBOX_QUICK_FILTERS.map((entry) => ({
        value: entry.id,
        label: (
          <>
            {entry.label} <span className="font-mono tabular-nums text-muted-foreground">{counts[entry.id]}</span>
          </>
        ),
      })),
    [counts],
  )
  const handleChange = useCallback((next: InboxQuickFilter) => useInboxStore.getState().setQuickFilter(next), [])
  return (
    <div role="group" aria-label="Quick filter" className="max-w-full overflow-x-auto">
      <SegmentedControl value={value} onValueChange={handleChange} options={options} size="sm" />
    </div>
  )
}
