import { useCallback, useMemo } from "react"
import type { InboxFilter } from "../../shared/inbox/types"
import { SearchableSelect, type SearchableOption } from "../components/ui/searchable-select"
import { INBOX_SOURCE_FILTERS } from "../lib/inboxPresentation"
import type { InboundTargets } from "../lib/webhookTargets"
import { cn } from "../lib/utils"
import { useInboxStore } from "../stores/inboxStore"

interface Props {
  filter: InboxFilter
  targets: InboundTargets
}

const ALL = "all"

function FilterChip({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors duration-[var(--motion-quick)] motion-reduce:transition-none",
        active ? "border-border bg-muted font-medium text-foreground" : "border-border/0 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}

export function InboxFilterBar({ filter, targets }: Props) {
  const setFilter = useInboxStore.getState().setFilter

  const handleAttention = useCallback(() => {
    setFilter({ ...filter, attentionOnly: filter.attentionOnly === true ? undefined : true })
  }, [filter, setFilter])

  const handleSourceKind = useCallback(
    (kind: NonNullable<InboxFilter["sourceKind"]>) => {
      setFilter({ ...filter, sourceKind: filter.sourceKind === kind ? undefined : kind })
    },
    [filter, setFilter],
  )

  const handleProject = useCallback(
    (value: string) => setFilter({ ...filter, projectId: value === ALL ? undefined : value }),
    [filter, setFilter],
  )
  const handleChat = useCallback(
    (value: string) => setFilter({ ...filter, chatId: value === ALL ? undefined : value }),
    [filter, setFilter],
  )

  const projectOptions = useMemo<SearchableOption[]>(
    () => [{ value: ALL, label: "All projects" }, ...targets.projects],
    [targets.projects],
  )
  const chatOptions = useMemo<SearchableOption[]>(
    () => [{ value: ALL, label: "All chats" }, ...targets.chats],
    [targets.chats],
  )

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter activity">
      <FilterChip label="Needs attention" active={filter.attentionOnly === true} onToggle={handleAttention} />
      {INBOX_SOURCE_FILTERS.map((entry) => (
        <FilterChip
          key={entry.kind}
          label={entry.label}
          active={filter.sourceKind === entry.kind}
          onToggle={() => handleSourceKind(entry.kind)}
        />
      ))}
      <div className="w-44">
        <SearchableSelect
          value={filter.projectId ?? ALL}
          options={projectOptions}
          placeholder="All projects"
          searchPlaceholder="Search projects"
          onValueChange={handleProject}
        />
      </div>
      <div className="w-52">
        <SearchableSelect
          value={filter.chatId ?? ALL}
          options={chatOptions}
          placeholder="All chats"
          searchPlaceholder="Search chats"
          onValueChange={handleChat}
        />
      </div>
    </div>
  )
}
