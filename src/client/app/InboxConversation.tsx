import { useCallback, useEffect, useRef } from "react"
import type { InboundMessage, InboxThread } from "../../shared/inbox/types"
import { renderMarkdownBlocks } from "../components/lexical/markdown/renderMessage"
import { RuledLabel } from "../components/messages/shared"
import { Button } from "../components/ui/button"
import { formatStartedClock } from "../lib/formatters"
import { fencedJson, groupEntriesByDay, threadEntries } from "../lib/inboxPresentation"
import { selectSnapshotAt, useInboxStore } from "../stores/inboxStore"
import { InboxAvatar } from "./InboxAvatar"
import { InboxOutboundEntry } from "./InboxOutboundEntry"

function InboundBubble({ message, sender }: { message: InboundMessage; sender: string }) {
  const rawOpen = useInboxStore((state) => state.rawOpen[message.id] === true)
  const handleToggle = useCallback(() => useInboxStore.getState().toggleRaw(message.id), [message.id])
  return (
    <li className="flex items-end gap-2 py-1.5">
      <InboxAvatar name={sender} className="h-7 w-7" />
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-bl-sm border border-border bg-muted px-3.5 py-2">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.text ?? message.preview}</p>
        </div>
        <div className="mt-1 flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{formatStartedClock(message.ts)}</span>
          <Button variant="link" size="none" className="h-auto text-xs" aria-expanded={rawOpen} onClick={handleToggle}>
            {rawOpen ? "Hide raw" : "Show raw"}
          </Button>
        </div>
        {rawOpen ? <div className="mt-2 min-w-0">{renderMarkdownBlocks(fencedJson(message.payload))}</div> : null}
      </div>
    </li>
  )
}

export function InboxConversation({ thread }: { thread: InboxThread }) {
  const snapshotAt = useInboxStore(selectSnapshotAt)
  const days = groupEntriesByDay(threadEntries(thread), snapshotAt > 0 ? snapshotAt : thread.lastMessageAt)
  const newestEntryTs = days.at(-1)?.entries.at(-1)?.ts ?? 0
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
  }, [thread.id, newestEntryTs, days.length])

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <section aria-label="Messages" className="mx-auto w-full max-w-[720px] space-y-2 px-4 py-4">
        <h3 className="sr-only">
          Messages <span className="tabular-nums">{thread.messages.length}</span>
        </h3>
        {days.map((day) => (
          <div key={day.key} role="group" aria-label={day.label} className="space-y-1">
            <RuledLabel>{day.label}</RuledLabel>
            <ul>
              {day.entries.map((entry) =>
                entry.kind === "inbound" ? (
                  <InboundBubble key={entry.message.id} message={entry.message} sender={thread.sender} />
                ) : (
                  <InboxOutboundEntry key={entry.outbound.id} thread={thread} outbound={entry.outbound} />
                ),
              )}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
