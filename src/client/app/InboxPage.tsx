import { useCallback, useEffect, useMemo } from "react"
import { Inbox } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import type { InboxActivityItem } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import {
  EMPTY_FILTER,
  groupByDay,
  olderPageCursors,
  visibleRecords,
  type InboxRecord,
  type InboxTabId,
} from "../lib/inboxFilter"
import { readInboxPage, sendInboxCommand } from "../lib/inboxCommands"
import { listWebhookTargets } from "../lib/webhookTargets"
import {
  selectInboxFilter,
  selectInboxItems,
  selectInboxTab,
  selectInboxThreads,
  selectInboxTotal,
  selectInboxUnreadCount,
  selectOlderExhausted,
  selectSelectedThread,
  selectSnapshotAt,
  useInboxStore,
} from "../stores/inboxStore"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { InboxActivityRow } from "./InboxActivityRow"
import { InboxFilterBar } from "./InboxFilterBar"
import { InboxThreadDetail } from "./InboxThreadDetail"
import { InboxThreadRow } from "./InboxThreadRow"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  threadId: string | null
}

const TAB_OPTIONS: SegmentedOption<InboxTabId>[] = [
  { value: "inbox", label: "Inbox" },
  { value: "activity", label: "Activity" },
]

const MARK_ALL_KEY = pendingActionKey("inbox.markAllRead")
const LOAD_OLDER_KEY = pendingActionKey("inbox.page")

function EmptyInbox() {
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

function EmptyList({ tab }: { tab: InboxTabId }) {
  if (tab === "inbox") return <EmptyInbox />
  return <p className="px-4 py-10 text-sm text-muted-foreground">No activity matches this view yet.</p>
}

export function InboxPage({ threadId }: Props) {
  const socket = useOptionalKannaSocket()
  const navigate = useNavigate()
  const tab = useInboxStore(selectInboxTab)
  const filter = useInboxStore(selectInboxFilter)
  const threads = useInboxStore(selectInboxThreads)
  const items = useInboxStore(selectInboxItems)
  const total = useInboxStore(selectInboxTotal)
  const unread = useInboxStore(selectInboxUnreadCount)
  const exhausted = useInboxStore(selectOlderExhausted)
  const snapshotAt = useInboxStore(selectSnapshotAt)
  const selected = useInboxStore(selectSelectedThread)
  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const targets = useMemo(() => listWebhookTargets(sidebarData), [sidebarData])
  const markAllPending = usePendingAction(MARK_ALL_KEY)
  const olderPending = usePendingAction(LOAD_OLDER_KEY)

  const activeFilter = tab === "activity" ? filter : EMPTY_FILTER
  const records = useMemo(() => visibleRecords(tab, threads, items, activeFilter), [tab, threads, items, activeFilter])
  const groups = useMemo(() => groupByDay(records, snapshotAt), [records, snapshotAt])

  useEffect(() => {
    useInboxStore.getState().select(threadId)
  }, [threadId])

  const selectedId = selected?.id ?? null
  const selectedUnread = selected?.unread === true
  useEffect(() => {
    if (selectedId === null || !selectedUnread) return
    runPendingAction(pendingActionKey("inbox.markRead", selectedId), async () => {
      await sendInboxCommand(socket, { type: "inbox.markRead", ids: [selectedId] })
    })
  }, [selectedId, selectedUnread, socket])

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
          await sendInboxCommand(socket, { type: "inbox.markRead", ids: [item.id] })
        })
      }
      if (item.chatId !== undefined) navigate(`/chat/${item.chatId}`)
    },
    [navigate, socket],
  )

  const handleMarkAll = useCallback(() => {
    runPendingAction(MARK_ALL_KEY, async () => {
      await sendInboxCommand(socket, { type: "inbox.markAllRead" })
    })
  }, [socket])

  const handleLoadOlder = useCallback(() => {
    runPendingAction(LOAD_OLDER_KEY, async () => {
      const state = useInboxStore.getState()
      const cursors = olderPageCursors(state.threads, state.items, state.filter)
      const [olderThreads, olderItems] = await Promise.all([
        sendInboxCommand(socket, { type: "inbox.page", beforeTs: cursors.threadBefore, limit: 50, filter: state.filter }),
        sendInboxCommand(socket, { type: "inbox.page", beforeTs: cursors.itemBefore, limit: 50, filter: state.filter }),
      ])
      useInboxStore.getState().appendPage({
        threads: readInboxPage(olderThreads).threads,
        items: readInboxPage(olderItems).items,
      })
    })
  }, [socket])

  const hasMore = tab === "activity" && !exhausted && threads.length + items.length < total

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border px-4 pb-3 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
            <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Inbox
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{unread} unread</span>
          </h1>
          <Button size="sm" variant="secondary" disabled={unread === 0} pending={markAllPending} onClick={handleMarkAll}>
            Mark all read
          </Button>
        </div>
        <SegmentedControl value={tab} onValueChange={handleTab} options={TAB_OPTIONS} size="sm" />
        {tab === "activity" ? <InboxFilterBar filter={filter} targets={targets} /> : null}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto md:max-w-[440px] md:flex-none md:basis-[420px] md:border-r md:border-border">
          {records.length === 0 ? (
            <EmptyList tab={tab} />
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <h2 className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">{group.label}</h2>
                {group.records.map((record) => (
                  <InboxRecordRow
                    key={record.id}
                    record={record}
                    selectedId={selectedId}
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
            <InboxThreadDetail thread={selected} onBack={handleCloseDetail} onArchived={handleCloseDetail} />
          </div>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  record: InboxRecord
  selectedId: string | null
  onOpenThread: (threadId: string) => void
  onOpenItem: (item: InboxActivityItem) => void
}

function InboxRecordRow({ record, selectedId, onOpenThread, onOpenItem }: RowProps) {
  if (record.kind === "thread") {
    return <InboxThreadRow thread={record.thread} selected={record.id === selectedId} onOpen={onOpenThread} />
  }
  return <InboxActivityRow item={record.item} onOpen={onOpenItem} />
}
