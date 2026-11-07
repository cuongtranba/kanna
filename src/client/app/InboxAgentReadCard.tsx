import type { InboxThread } from "../../shared/inbox/types"
import { StateMarkLabel } from "../components/ui/state-mark"
import { isAgentReading, reportSummaryText, verdictDisplay } from "../lib/inboxPresentation"

export function InboxAgentReadCard({ thread }: { thread: InboxThread }) {
  return (
    <section aria-label="Agent's read" className="space-y-1.5 rounded-lg border border-border bg-muted px-3 py-3">
      <h3 className="text-sm font-semibold text-foreground">Agent&apos;s read</h3>
      <AgentRead thread={thread} />
    </section>
  )
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
      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{reportSummaryText(thread.report.summary)}</p>
    </div>
  )
}
