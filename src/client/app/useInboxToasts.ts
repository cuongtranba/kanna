import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { raisesNotification } from "../../shared/inbox/policy"
import type { InboxThread } from "../../shared/inbox/types"
import { sonnerInboxToastPort, type InboxToastPort } from "../lib/inboxToast"
import { selectInboxThreads, selectSnapshotAt, useInboxStore } from "../stores/inboxStore"

export const MAX_INBOX_TOASTS = 3

function needsYouIds(threads: readonly InboxThread[]): Set<string> {
  return new Set(threads.filter(raisesNotification).map((thread) => thread.id))
}

export function newlyNeedingYou(
  previous: ReadonlySet<string>,
  threads: readonly InboxThread[],
): InboxThread[] {
  return threads.filter((thread) => raisesNotification(thread) && !previous.has(thread.id))
}

export function useInboxToasts(port: InboxToastPort = sonnerInboxToastPort): void {
  const threads = useInboxStore(selectInboxThreads)
  const snapshotAt = useInboxStore(selectSnapshotAt)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const knownRef = useRef<ReadonlySet<string> | null>(null)

  useEffect(() => {
    if (snapshotAt === 0) return
    const previous = knownRef.current
    knownRef.current = needsYouIds(threads)
    if (previous === null || pathname.startsWith("/inbox")) return
    const fresh = newlyNeedingYou(previous, threads)
    for (const thread of fresh.slice(0, MAX_INBOX_TOASTS)) {
      port.show({
        title: `${thread.sender} needs you`,
        description: thread.report?.summary.trim() || thread.sourceName,
        actionLabel: "Open",
        onAction: () => {
          navigate(`/inbox/${thread.id}`)
        },
      })
    }
    const overflow = fresh.length - MAX_INBOX_TOASTS
    if (overflow > 0) {
      port.show({
        title: `and ${String(overflow)} more need you`,
        description: "Open the inbox to see them all.",
        actionLabel: "Open",
        onAction: () => {
          navigate("/inbox")
        },
      })
    }
  }, [navigate, pathname, port, snapshotAt, threads])
}
