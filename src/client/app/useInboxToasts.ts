import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import type { InboxThread } from "../../shared/inbox/types"
import { runDetached } from "../lib/runDetached"
import { selectInboxThreads, selectSnapshotAt, useInboxStore } from "../stores/inboxStore"

export interface InboxToastRequest {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

export interface InboxToastPort {
  show(request: InboxToastRequest): void
}

export const MAX_INBOX_TOASTS = 3

export const sonnerInboxToastPort: InboxToastPort = {
  show(request) {
    runDetached(
      "inbox toast",
      import("sonner").then(({ toast }) => {
        toast(request.title, {
          description: request.description,
          action: { label: request.actionLabel, onClick: request.onAction },
        })
      }),
    )
  },
}

function needsYouIds(threads: readonly InboxThread[]): Set<string> {
  return new Set(threads.filter((thread) => thread.state === "needs_you").map((thread) => thread.id))
}

export function newlyNeedingYou(
  previous: ReadonlySet<string>,
  threads: readonly InboxThread[],
): InboxThread[] {
  return threads.filter((thread) => thread.state === "needs_you" && !previous.has(thread.id))
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
