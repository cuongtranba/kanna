import type { ReactNode } from "react"
import { GitBranch, GitPullRequest, Search } from "lucide-react"
import type { ChatBranchListEntry } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { pendingActionKey, usePendingAction } from "../../stores/pendingActionsStore"
import { Input } from "../ui/input"
import { SectionCaption } from "../ui/plate"
import { Spinner } from "../ui/spinner"
import { formatRelativeTime } from "./repositoryWorkspace"

export function BranchSearchInput({
  value,
  onChange,
  placeholder,
  disabled,
  trailingAction,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  trailingAction?: ReactNode
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn("h-9 pl-7 text-sm", trailingAction ? "pr-14" : undefined)}
        disabled={disabled}
      />
      {trailingAction ? <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailingAction}</div> : null}
    </div>
  )
}

const NO_PENDING_ACTION_KEY = ""

function BranchListRow({
  entry,
  isSelected,
  disabled,
  pendingKey,
  onSelect,
}: {
  entry: ChatBranchListEntry
  isSelected: boolean
  disabled?: boolean
  pendingKey: string
  onSelect: (entry: ChatBranchListEntry) => void
}) {
  const pending = usePendingAction(pendingKey)
  const icon = entry.kind === "pull_request"
    ? <GitPullRequest className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    : <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={() => onSelect(entry)}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-60",
        isSelected
          ? "bg-accent text-foreground"
          : "hover:bg-accent"
      )}
    >
      {pending ? <Spinner className="mt-0.5 shrink-0 text-muted-foreground" /> : icon}
      <div className="min-w-0 flex-1">
        <div className="flex w-full items-center gap-3">
          <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">{entry.displayName}</div>
          {entry.updatedAt ? (
            <div className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
              {formatRelativeTime(entry.updatedAt)}
            </div>
          ) : null}
        </div>
        {(entry.kind === "pull_request" && entry.description) || entry.headLabel ? (
          <div className="truncate text-xs text-muted-foreground">
            {entry.kind === "pull_request" ? (entry.description ?? entry.headLabel ?? entry.name) : (entry.headLabel ?? undefined)}
          </div>
        ) : null}
      </div>
    </button>
  )
}

export function BranchListSection({
  title,
  entries,
  emptyLabel,
  selectedName,
  disabled,
  stickyTitle = false,
  pendingScope,
  onSelect,
}: {
  title: string
  entries: ChatBranchListEntry[]
  emptyLabel?: string
  selectedName?: string | null
  disabled?: boolean
  stickyTitle?: boolean
  pendingScope?: string
  onSelect: (entry: ChatBranchListEntry) => void
}) {
  if (entries.length === 0 && !emptyLabel) {
    return null
  }

  return (
    <div className="space-y-1">
      <SectionCaption
        label={title}
        fact={entries.length > 0 ? String(entries.length) : undefined}
        className={cn(stickyTitle && "sticky top-0 z-10 bg-background")}
      />
      {entries.length === 0 ? (
        <div className="px-1 py-1 text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        entries.map((entry) => (
          <BranchListRow
            key={entry.id}
            entry={entry}
            isSelected={selectedName === entry.name}
            disabled={disabled}
            pendingKey={pendingScope ? pendingActionKey(pendingScope, entry.id) : NO_PENDING_ACTION_KEY}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}
