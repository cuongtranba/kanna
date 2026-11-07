import { useCallback, useEffect, useMemo } from "react"
import { Inbox, Keyboard } from "lucide-react"
import { useNavigate } from "react-router-dom"
import type { InboxActivityItem, InboxFilter } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import {
  EMPTY_FILTER,
  groupRecords,
  inboxEmptyReason,
  inboxQuickCounts,
  olderPageCursors,
  visibleRecords,
  type InboxQuickCounts,
  type InboxQuickFilter,
  type InboxRecord,
  type InboxTabId,
} from "../lib/inboxFilter"
import { adjacentThreadId } from "../lib/inboxKeyboard"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { listInboundTargets } from "../lib/webhookTargets"
import { cn } from "../lib/utils"
import {
  selectCheckedThreads,
  selectInboxFilter,
  selectInboxItems,
  selectInboxTab,
  selectInboxThreads,
  selectInboxTotal,
  selectInboxUnreadCount,
  selectKeepUnreadId,
  selectOlderExhausted,
  selectQuickFilter,
  selectSearchQuery,
  selectSelectedThread,
  selectSnapshotAt,
  useInboxStore,
} from "../stores/inboxStore"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { InboxActivityRow } from "./InboxActivityRow"
import { InboxBulkBar } from "./InboxBulkBar"
import { InboxFilterBar } from "./InboxFilterBar"
import { InboxEmptyList } from "./InboxListStates"
import { InboxQuickFilters } from "./InboxQuickFilters"
import { InboxSearchBox } from "./InboxSearchBox"
import { InboxShortcutHint } from "./InboxShortcutHint"
import { InboxShortcutsDialog } from "./InboxShortcutsDialog"
import { InboxThreadDetail } from "./InboxThreadDetail"
import { InboxThreadRow } from "./InboxThreadRow"
import { useInboxKeyboard } from "./useInboxKeyboard"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { chatPath } from "../lib/paneTree"

interface Props {
  threadId: string | null
}

const TAB_OPTIONS: SegmentedOption<InboxTabId>[] = [
  { value: "inbox", label: "Inbox" },
  { value: "activity", label: "Activity" },
]

const MARK_ALL_KEY = pendingActionKey("inbox.markAllRead")
const LOAD_OLDER_KEY = pendingActionKey("inbox.page")

export function InboxPage({ threadId }: Props) {
  const socket = useOptionalKannaSocket()
  const navigate = useNavigate()
  const tab = useInboxStore(selectInboxTab)
  const filter = useInboxStore(selectInboxFilter)
  const quick = useInboxStore(selectQuickFilter)
  const query = useInboxStore(selectSearchQuery)
  const threads = useInboxStore(selectInboxThreads)
  const items = useInboxStore(selectInboxItems)
  const total = useInboxStore(selectInboxTotal)
  const unread = useInboxStore(selectInboxUnreadCount)
  const exhausted = useInboxStore(selectOlderExhausted)
  const snapshotAt = useInboxStore(selectSnapshotAt)
  const selected = useInboxStore(selectSelectedThread)
  const checked = useInboxStore(selectCheckedThreads)
  const keepUnreadId = useInboxStore(selectKeepUnreadId)
  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const targets = useMemo(() => listInboundTargets(sidebarData), [sidebarData])
  const markAllPending = usePendingAction(MARK_ALL_KEY)
  const olderPending = usePendingAction(LOAD_OLDER_KEY)

  const activeFilter = tab === "activity" ? filter : EMPTY_FILTER
  const records = useMemo(
    () => visibleRecords(tab, threads, items, activeFilter, quick, query),
    [tab, threads, items, activeFilter, quick, query],
  )
  const groups = useMemo(() => groupRecords(tab, records, snapshotAt), [tab, records, snapshotAt])
  const counts = useMemo(() => inboxQuickCounts(threads, items, query), [threads, items, query])
  const visibleThreadIds = useMemo(
    () => new Set(records.flatMap((record) => (record.kind === "thread" ? [record.id] : []))),
    [records],
  )
  const checkedIds = useMemo(
    () => records.flatMap((record) => (record.kind === "thread" && checked[record.id] === true ? [record.id] : [])),
    [records, checked],
  )
  const anyChecked = checkedIds.length > 0

  useEffect(() => {
    useInboxStore.getState().pruneChecked(visibleThreadIds)
  }, [visibleThreadIds])

  useEffect(() => {
    useInboxStore.getState().select(threadId)
  }, [threadId])

  const selectedId = selected?.id ?? null
  const selectedUnread = selected?.unread === true
  useEffect(() => {
    if (selectedId === null || !selectedUnread || keepUnreadId === selectedId) return
    runPendingAction(pendingActionKey("inbox.markRead", selectedId), async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.markRead", ids: [selectedId] })
    })
  }, [keepUnreadId, selectedId, selectedUnread, socket])

  const handleTab = useCallback((next: InboxTabId) => useInboxStore.getState().setTab(next), [])

  const handleOpenThread = useCallback(
    (id: string) => {
      navigate(`/inbox/${id}`)
    },
    [navigate],
  )
  const handleCloseDetail = useCallback(() => {
    navigate("/inbox")
  }, [navigate])

  const handleOpenItem = useCallback(
    (item: InboxActivityItem) => {
      if (item.unread) {
        runPendingAction(pendingActionKey("inbox.markRead", item.id), async () => {
          await sendCommandWithFeedback(socket, { type: "inbox.markRead", ids: [item.id] })
        })
      }
      if (item.chatId !== undefined) navigate(chatPath(item.chatId))
    },
    [navigate, socket],
  )

  const handleBulkRemoved = useCallback(
    (removedIds: readonly string[]) => {
      useInboxStore.getState().clearChecked()
      if (selectedId !== null && removedIds.includes(selectedId)) navigate("/inbox")
    },
    [navigate, selectedId],
  )

  const handleMarkAll = useCallback(() => {
    runPendingAction(MARK_ALL_KEY, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.markAllRead" })
    })
  }, [socket])

  const handleLoadOlder = useCallback(() => {
    runPendingAction(LOAD_OLDER_KEY, async () => {
      const state = useInboxStore.getState()
      const cursors = olderPageCursors(state.threads, state.items, state.filter)
      const [olderThreads, olderItems] = await Promise.all([
        sendCommandWithFeedback(socket, { type: "inbox.page", beforeTs: cursors.threadBefore, limit: 50, filter: state.filter }),
        sendCommandWithFeedback(socket, { type: "inbox.page", beforeTs: cursors.itemBefore, limit: 50, filter: state.filter }),
      ])
      useInboxStore.getState().appendPage({
        threads: olderThreads.threads,
        items: olderItems.items,
      })
    })
  }, [socket])

  useInboxKeyboard(records, selected, handleOpenThread, handleCloseDetail)

  const inList = selectedId !== null && records.some((record) => record.id === selectedId)
  const prevId = inList ? adjacentThreadId(records, selectedId, -1) : null
  const nextId = inList ? adjacentThreadId(records, selectedId, 1) : null
  const emptyReason = inboxEmptyReason({ loaded: snapshotAt > 0, tab, quick, query, inboxCount: counts.all })
  const handleShowShortcuts = useCallback(() => useInboxStore.getState().setShortcutsOpen(true), [])

  const hasMore = tab === "activity" && !exhausted && threads.length + items.length < total

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("space-y-3 border-b border-border px-4 pb-3 pt-6", selected !== null && "max-md:hidden")}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
            <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Inbox
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{unread} unread</span>
          </h1>
          <div className="flex items-center gap-2">
            <InboxShortcutHint label="Keyboard shortcuts" action="inboxShowShortcuts">
              <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" className="max-md:hidden" onClick={handleShowShortcuts}>
                <Keyboard className="h-4 w-4" aria-hidden="true" />
              </Button>
            </InboxShortcutHint>
            <Button size="sm" variant="secondary" disabled={unread === 0} pending={markAllPending} onClick={handleMarkAll}>
              Mark all read
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={tab} onValueChange={handleTab} options={TAB_OPTIONS} size="sm" />
          <InboxSearchBox />
        </div>
        <InboxControlsRow
          checkedIds={checkedIds}
          tab={tab}
          filter={filter}
          targets={targets}
          quick={quick}
          counts={counts}
          onBulkRemoved={handleBulkRemoved}
        />
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto md:max-w-[440px] md:flex-none md:basis-[420px] md:border-r md:border-border">
          {records.length === 0 ? (
            <InboxEmptyList reason={emptyReason} tab={tab} quick={quick} query={query} />
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <h2 className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">{group.label}</h2>
                {group.records.map((record) => (
                  <InboxRecordRow
                    key={record.id}
                    record={record}
                    selectedId={selectedId}
                    checked={checked}
                    anyChecked={anyChecked}
                    now={snapshotAt}
                    onOpenThread={handleOpenThread}
                    onOpenItem={handleOpenItem}
                  />
                ))}
              </section>
            ))
          )}
          {hasMore ? (
            <div className="px-4 py-4">
              <Button variant="secondary" size="sm" pending={olderPending} onClick={handleLoadOlder}>
                Load older
              </Button>
            </div>
          ) : null}
        </div>
        {selected === null ? (
          <div className="hidden min-w-0 flex-1 items-center justify-center px-6 text-sm text-muted-foreground md:flex">
            Select a thread to read it.
          </div>
        ) : (
          <div className="absolute inset-0 z-20 flex min-w-0 bg-background md:static md:z-auto md:flex-1">
            <InboxThreadDetail
              thread={selected}
              prevId={prevId}
              nextId={nextId}
              onOpenThread={handleOpenThread}
              onBack={handleCloseDetail}
              onArchived={handleCloseDetail}
              onSnoozed={handleCloseDetail}
            />
          </div>
        )}
      </div>
      <InboxShortcutsDialog />
    </div>
  )
}

interface RowProps {
  record: InboxRecord
  selectedId: string | null
  checked: Readonly<Record<string, true>>
  anyChecked: boolean
  now: number
  onOpenThread: (threadId: string) => void
  onOpenItem: (item: InboxActivityItem) => void
}

function InboxRecordRow({ record, selectedId, checked, anyChecked, now, onOpenThread, onOpenItem }: RowProps) {
  if (record.kind === "thread") {
    return (
      <InboxThreadRow
        thread={record.thread}
        selected={record.id === selectedId}
        checked={checked[record.id] === true}
        anyChecked={anyChecked}
        now={now}
        onOpen={onOpenThread}
      />
    )
  }
  return <InboxActivityRow item={record.item} now={now} onOpen={onOpenItem} />
}

interface ControlsProps {
  checkedIds: readonly string[]
  tab: InboxTabId
  filter: InboxFilter
  targets: ReturnType<typeof listInboundTargets>
  quick: InboxQuickFilter
  counts: InboxQuickCounts
  onBulkRemoved: (threadIds: readonly string[]) => void
}

function InboxControlsRow({ checkedIds, tab, filter, targets, quick, counts, onBulkRemoved }: ControlsProps) {
  if (checkedIds.length > 0) return <InboxBulkBar threadIds={checkedIds} onArchived={onBulkRemoved} onSnoozed={onBulkRemoved} />
  if (tab === "activity") return <InboxFilterBar filter={filter} targets={targets} />
  return <InboxQuickFilters value={quick} counts={counts} />
}
