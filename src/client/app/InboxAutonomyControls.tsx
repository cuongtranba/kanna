import { useCallback } from "react"
import { isInboxAutonomyLevel } from "../../shared/inbox/autonomy"
import type { InboxThread } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { useNow } from "../hooks/useNow"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { inboxAutonomyView, isAgentPaused, SOURCE_DEFAULT_VALUE, type InboxAutonomyView } from "../lib/inboxAutonomy"
import { selectMcpSources, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

function AgentPausedChip({ thread }: { thread: InboxThread }) {
  const socket = useOptionalKannaSocket()
  const now = useNow(1_000)
  const resumeKey = pendingActionKey("inbox.resumeAgent", thread.id)
  const resuming = usePendingAction(resumeKey)
  const threadId = thread.id

  const handleResume = useCallback(() => {
    runPendingAction(resumeKey, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.resumeAgent", threadId })
    })
  }, [resumeKey, socket, threadId])

  if (!isAgentPaused(thread, now)) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-foreground">
      Agent paused
      <span className="text-muted-foreground">·</span>
      <Button variant="link" size="none" className="h-auto text-xs" pending={resuming} onClick={handleResume}>
        Resume
      </Button>
    </span>
  )
}

function AutonomySelect({ thread, view }: { thread: InboxThread; view: InboxAutonomyView }) {
  const socket = useOptionalKannaSocket()
  const levelKey = pendingActionKey("inbox.setThreadAutonomy", thread.id)
  const changing = usePendingAction(levelKey)
  const threadId = thread.id

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value
      const level = isInboxAutonomyLevel(value) ? value : null
      runPendingAction(levelKey, async () => {
        await sendCommandWithFeedback(socket, { type: "inbox.setThreadAutonomy", threadId, level })
      })
    },
    [levelKey, socket, threadId],
  )

  return (
    <label className="inline-flex items-center gap-1.5">
      <span>Autonomy</span>
      <select
        aria-label="Autonomy"
        value={thread.autonomy ?? SOURCE_DEFAULT_VALUE}
        disabled={changing}
        onChange={handleChange}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      >
        {view.options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function AllowContactButton({ thread, view }: { thread: InboxThread; view: InboxAutonomyView }) {
  const socket = useOptionalKannaSocket()
  const allowKey = pendingActionKey("mcpSources.allowContact", view.sourceId, thread.threadKey)
  const allowing = usePendingAction(allowKey)
  const { sourceId, allowlist } = view
  const { threadKey } = thread

  const handleAllow = useCallback(() => {
    runPendingAction(allowKey, async () => {
      await sendCommandWithFeedback(socket, {
        type: "settings.writeAppSettingsPatch",
        patch: { mcpSources: { update: { id: sourceId, patch: { autonomy: { allowlist: [...allowlist, threadKey] } } } } },
      })
    })
  }, [allowKey, allowlist, socket, sourceId, threadKey])

  return (
    <Button variant="secondary" size="sm" pending={allowing} onClick={handleAllow}>
      Allow auto for this contact
    </Button>
  )
}

export function InboxAutonomyControls({ thread }: { thread: InboxThread }) {
  const sources = useAppSettingsStore(selectMcpSources)
  const view = inboxAutonomyView(thread, sources)
  if (view === null && thread.agentPausedUntil === undefined) return null
  const blockedReason = view?.blockedReason ?? null
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {view === null ? null : <AutonomySelect thread={thread} view={view} />}
        {thread.agentPausedUntil === undefined ? null : <AgentPausedChip thread={thread} />}
        {view?.offerAllowContact === true ? <AllowContactButton thread={thread} view={view} /> : null}
      </div>
      {blockedReason === null ? null : <p className="text-xs text-muted-foreground">{blockedReason}</p>}
    </div>
  )
}
