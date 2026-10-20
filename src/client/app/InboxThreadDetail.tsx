import { useCallback } from "react"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import type { InboundMessage, InboxThread } from "../../shared/inbox/types"
import { renderMarkdownBlocks } from "../components/lexical/markdown/renderMessage"
import { Button } from "../components/ui/button"
import { StateMarkLabel } from "../components/ui/state-mark"
import { formatStartedClock } from "../lib/formatters"
import {
  fencedJson,
  isAgentReading,
  reportSummaryText,
  threadStateDisplay,
  verdictDisplay,
} from "../lib/inboxPresentation"
import { useInboxStore } from "../stores/inboxStore"
import { InboxReplyComposer } from "./InboxReplyComposer"

interface Props {
  thread: InboxThread
  onBack: () => void
  onArchived: () => void
}

function AgentRead({ thread }: { thread: InboxThread }) {
  if (isAgentReading(thread)) {
    return <StateMarkLabel tone="active" label="Agent is reading…" />
  }
  if (thread.report === undefined) {
    return <p className="text-sm text-muted-foreground">The agent has not read this yet.</p>
  }
  const verdict = verdictDisplay(thread.report.verdict)
  return (
    <div className="space-y-1.5">
      <StateMarkLabel tone={verdict.tone} label={verdict.label} />
      <p className="whitespace-pre-wrap text-sm text-foreground">{reportSummaryText(thread.report.summary)}</p>
    </div>
  )
}

function MessageEntry({ message }: { message: InboundMessage }) {
  const rawOpen = useInboxStore((state) => state.rawOpen[message.id] === true)
  const handleToggle = useCallback(() => useInboxStore.getState().toggleRaw(message.id), [message.id])
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">{message.preview}</p>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatStartedClock(message.ts)}</span>
      </div>
      <Button variant="link" size="none" className="mt-1 h-auto text-xs" aria-expanded={rawOpen} onClick={handleToggle}>
        {rawOpen ? "Hide raw" : "Show raw"}
      </Button>
      {rawOpen ? <div className="mt-2 min-w-0">{renderMarkdownBlocks(fencedJson(message.payload))}</div> : null}
    </li>
  )
}

export function InboxThreadDetail({ thread, onBack, onArchived }: Props) {
  const display = threadStateDisplay(thread)
  return (
    <article aria-label={`Thread from ${thread.sender}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] space-y-6 px-4 py-6">
        <header className="space-y-1.5">
          <Button variant="ghost" size="sm" className="-ml-2 md:hidden" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Inbox
          </Button>
          <h2 className="truncate text-lg font-medium text-foreground">{thread.sender}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{thread.sourceName}</span>
            <span className="font-mono tabular-nums">{new Date(thread.lastMessageAt).toLocaleString()}</span>
            <StateMarkLabel tone={display.tone} label={display.label} />
            {thread.chatId === undefined ? null : (
              <Link
                to={`/chat/${thread.chatId}`}
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                Open chat
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Link>
            )}
          </div>
        </header>
        <section aria-label="Agent's read" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Agent&apos;s read</h3>
          <AgentRead thread={thread} />
        </section>
        <section aria-label="Messages" className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            Messages <span className="font-normal tabular-nums text-muted-foreground">{thread.messages.length}</span>
          </h3>
          <ul className="divide-y divide-border">
            {thread.messages.map((message) => (
              <MessageEntry key={message.id} message={message} />
            ))}
          </ul>
        </section>
        <InboxReplyComposer thread={thread} onArchived={onArchived} />
      </div>
    </article>
  )
}
