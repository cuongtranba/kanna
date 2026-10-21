import { useCallback, type ChangeEvent } from "react"
import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"

const FILTER_PLACEHOLDER = `on:
  issues:
    types: [assigned]
if: body.assignee.login == "octocat"`

export function WebhookGenericFields() {
  const filter = WebhookCreateStore.useScopedStore((state) => state.filter)
  const threadKeyPath = WebhookCreateStore.useScopedStore((state) => state.threadKeyPath)
  const senderPath = WebhookCreateStore.useScopedStore((state) => state.senderPath)
  const replyHint = WebhookCreateStore.useScopedStore((state) => state.replyHint)
  const setFilter = WebhookCreateStore.useScopedStore((state) => state.setFilter)
  const setThreadKeyPath = WebhookCreateStore.useScopedStore((state) => state.setThreadKeyPath)
  const setSenderPath = WebhookCreateStore.useScopedStore((state) => state.setSenderPath)
  const setReplyHint = WebhookCreateStore.useScopedStore((state) => state.setReplyHint)
  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setFilter(event.target.value),
    [setFilter],
  )
  const handleThreadKeyPathChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setThreadKeyPath(event.target.value),
    [setThreadKeyPath],
  )
  const handleSenderPathChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSenderPath(event.target.value),
    [setSenderPath],
  )
  const handleReplyHintChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setReplyHint(event.target.value),
    [setReplyHint],
  )
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="webhook-filter" className="text-sm font-medium text-foreground">Filter (optional)</label>
        <Textarea
          id="webhook-filter"
          className="font-mono"
          rows={5}
          value={filter}
          onChange={handleFilterChange}
          placeholder={FILTER_PLACEHOLDER}
        />
        <p className="text-xs text-muted-foreground">
          YAML with <code className="font-mono">on</code> (event name from{" "}
          <code className="font-mono">X-GitHub-Event</code>, optional <code className="font-mono">types</code> matched
          against <code className="font-mono">body.action</code>) and <code className="font-mono">if</code> (a CEL
          condition over <code className="font-mono">body</code>, <code className="font-mono">event</code> and{" "}
          <code className="font-mono">headers</code>). Deliveries that do not match are acknowledged and ignored.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="webhook-thread-key" className="text-sm font-medium text-foreground">Thread key path</label>
          <Input id="webhook-thread-key" className="font-mono" value={threadKeyPath} onChange={handleThreadKeyPathChange} />
          <p className="text-xs text-muted-foreground">Deliveries with the same value share one Inbox thread, and in spawn mode one chat.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="webhook-sender" className="text-sm font-medium text-foreground">Sender path</label>
          <Input id="webhook-sender" className="font-mono" value={senderPath} onChange={handleSenderPathChange} />
          <p className="text-xs text-muted-foreground">Shown as the sender of the thread.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="webhook-reply-hint" className="text-sm font-medium text-foreground">Reply hint</label>
        <Textarea id="webhook-reply-hint" rows={3} value={replyHint} onChange={handleReplyHintChange} />
        <p className="text-xs text-muted-foreground">
          Tells the agent how to send a reply through the server's tools when you answer from the Inbox.
        </p>
      </div>
    </>
  )
}
