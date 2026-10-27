import { create } from "zustand"
import type { InboxActivityItem, InboxFilter, InboxSnapshot, InboxThread } from "../../shared/inbox/types"
import { EMPTY_FILTER, type InboxTabId } from "../lib/inboxFilter"
import { omitKeyOrEmpty } from "../lib/recordOps"

const EMPTY_THREADS: readonly InboxThread[] = []
const EMPTY_ITEMS: readonly InboxActivityItem[] = []
const EMPTY_DRAFTS: Readonly<Record<string, string>> = {}
const NO_RAW_OPEN: Readonly<Record<string, true>> = {}

interface InboxPage {
  threads: readonly InboxThread[]
  items: readonly InboxActivityItem[]
}

interface InboxState {
  threads: readonly InboxThread[]
  items: readonly InboxActivityItem[]
  unreadCount: number
  total: number
  snapshotAt: number
  tab: InboxTabId
  filter: InboxFilter
  selectedThreadId: string | null
  replyDrafts: Readonly<Record<string, string>>
  olderExhausted: boolean
  rawOpen: Readonly<Record<string, true>>
  applySnapshot(snapshot: InboxSnapshot): void
  appendPage(page: InboxPage): void
  setTab(tab: InboxTabId): void
  setFilter(filter: InboxFilter): void
  toggleAttentionOnly(): void
  toggleSourceKind(kind: NonNullable<InboxFilter["sourceKind"]>): void
  setProjectFilter(projectId: string | null): void
  setChatFilter(chatId: string | null): void
  select(threadId: string | null): void
  setReplyDraft(threadId: string, text: string): void
  clearReplyDraft(threadId: string): void
  toggleRaw(messageId: string): void
}

function nonEmpty<T>(list: readonly T[], empty: readonly T[]): readonly T[] {
  return list.length > 0 ? list : empty
}

function olderThan<T extends { id: string }>(
  existing: readonly T[],
  fresh: readonly T[],
  tsOf: (entry: T) => number,
): T[] {
  if (fresh.length === 0) return []
  const freshIds = new Set(fresh.map((entry) => entry.id))
  const oldestFresh = Math.min(...fresh.map(tsOf))
  return existing.filter((entry) => !freshIds.has(entry.id) && tsOf(entry) < oldestFresh)
}

function mergeById<T extends { id: string }>(existing: readonly T[], page: readonly T[]): readonly T[] {
  if (page.length === 0) return existing
  const pageIds = new Set(page.map((entry) => entry.id))
  return [...existing.filter((entry) => !pageIds.has(entry.id)), ...page]
}

function refined(state: InboxState, change: Partial<InboxFilter>): Pick<InboxState, "filter" | "olderExhausted"> {
  return { filter: { ...state.filter, ...change }, olderExhausted: false }
}

const threadTs = (thread: InboxThread) => thread.lastMessageAt
const itemTs = (item: InboxActivityItem) => item.ts

export const useInboxStore = create<InboxState>()((set) => ({
  threads: EMPTY_THREADS,
  items: EMPTY_ITEMS,
  unreadCount: 0,
  total: 0,
  snapshotAt: 0,
  tab: "inbox",
  filter: EMPTY_FILTER,
  selectedThreadId: null,
  replyDrafts: EMPTY_DRAFTS,
  olderExhausted: false,
  rawOpen: NO_RAW_OPEN,
  applySnapshot: (snapshot) =>
    set((state) => ({
      threads: nonEmpty([...snapshot.threads, ...olderThan(state.threads, snapshot.threads, threadTs)], EMPTY_THREADS),
      items: nonEmpty([...snapshot.items, ...olderThan(state.items, snapshot.items, itemTs)], EMPTY_ITEMS),
      unreadCount: snapshot.unreadCount,
      total: snapshot.total,
      snapshotAt: Date.now(),
    })),
  appendPage: (page) =>
    set((state) => ({
      threads: nonEmpty(mergeById(state.threads, page.threads), EMPTY_THREADS),
      items: nonEmpty(mergeById(state.items, page.items), EMPTY_ITEMS),
      olderExhausted: page.threads.length === 0 && page.items.length === 0,
    })),
  setTab: (tab) => set({ tab }),
  setFilter: (filter) => set({ filter, olderExhausted: false }),
  toggleAttentionOnly: () =>
    set((state) => refined(state, { attentionOnly: state.filter.attentionOnly === true ? undefined : true })),
  toggleSourceKind: (kind) =>
    set((state) => refined(state, { sourceKind: state.filter.sourceKind === kind ? undefined : kind })),
  setProjectFilter: (projectId) => set((state) => refined(state, { projectId: projectId ?? undefined })),
  setChatFilter: (chatId) => set((state) => refined(state, { chatId: chatId ?? undefined })),
  select: (selectedThreadId) => set({ selectedThreadId }),
  setReplyDraft: (threadId, text) =>
    set((state) => ({ replyDrafts: { ...state.replyDrafts, [threadId]: text } })),
  clearReplyDraft: (threadId) =>
    set((state) => ({ replyDrafts: { ...state.replyDrafts, [threadId]: "" } })),
  toggleRaw: (messageId) =>
    set((state) => {
      if (state.rawOpen[messageId]) {
        return { rawOpen: omitKeyOrEmpty(state.rawOpen, messageId, NO_RAW_OPEN) }
      }
      return { rawOpen: { ...state.rawOpen, [messageId]: true } }
    }),
}))

export const selectInboxUnreadCount = (state: InboxState) => state.unreadCount
export const selectInboxThreads = (state: InboxState) => state.threads
export const selectInboxItems = (state: InboxState) => state.items
export const selectInboxTotal = (state: InboxState) => state.total
export const selectSnapshotAt = (state: InboxState) => state.snapshotAt
export const selectInboxTab = (state: InboxState) => state.tab
export const selectInboxFilter = (state: InboxState) => state.filter
export const selectSelectedThreadId = (state: InboxState) => state.selectedThreadId
export const selectOlderExhausted = (state: InboxState) => state.olderExhausted

export function selectSelectedThread(state: InboxState): InboxThread | null {
  const id = state.selectedThreadId
  if (id === null) return null
  return state.threads.find((thread) => thread.id === id) ?? null
}
