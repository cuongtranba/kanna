import { useMemo, useState } from "react"
import type { AutoContinueSchedule } from "../../../shared/types"
import { formatLocal, parseLocal } from "../../lib/autoContinueTime"
import { Input } from "../ui/input"
import { TranscriptActionCard, type CardAction } from "./TranscriptActionCard"

export interface AutoContinueCardProps {
  schedule: AutoContinueSchedule
  onAccept: (scheduledAtMs: number) => void
  onReschedule: (scheduledAtMs: number) => void
  onCancel: () => void
}

export function AutoContinueCard({ schedule, onAccept, onReschedule, onCancel }: AutoContinueCardProps) {
  const [draft, setDraft] = useState<string>(() => formatLocal(
    schedule.scheduledAt ?? schedule.resetAt,
    schedule.tz,
  ))
  const [editing, setEditing] = useState(false)

  const parsed = useMemo(() => parseLocal(draft, schedule.tz), [draft, schedule.tz])
  const isFuture = parsed !== null && parsed > Date.now()
  const inputInvalid = parsed === null ? "Use format dd/mm/yyyy hh:mm" :
    !isFuture ? "Time must be in the future" : null

  if (schedule.state === "fired") {
    const at = formatLocal(schedule.scheduledAt ?? schedule.resetAt, schedule.tz)
    return <TranscriptActionCard title={`Auto-continued at ${at}`} tone="success" />
  }

  if (schedule.state === "cancelled") {
    return <TranscriptActionCard title="Auto-continue cancelled" tone="muted" />
  }

  if (schedule.state === "proposed") {
    const passed = schedule.resetAt <= Date.now()
    const actions: CardAction[] = [
      {
        id: "schedule",
        label: "Schedule",
        variant: "primary",
        disabled: !isFuture,
        onClick: () => {
          if (parsed !== null) onAccept(parsed)
        },
      },
      {
        id: "dismiss",
        label: "Dismiss",
        variant: "ghost",
        onClick: () => onCancel(),
      },
    ]
    return (
      <TranscriptActionCard
        title="Rate limit hit — schedule auto-continue?"
        description={passed ? "Reset time has passed — accept to continue now." : undefined}
        body={
          <div className="space-y-1">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="dd/mm/yyyy hh:mm"
            />
            {inputInvalid && <div className="text-destructive text-xs">{inputInvalid}</div>}
          </div>
        }
        actions={actions}
      />
    )
  }

  // scheduled
  const displayAt = formatLocal(schedule.scheduledAt ?? schedule.resetAt, schedule.tz)
  const tzLabel = schedule.tz === "system" ? "local" : schedule.tz

  if (!editing) {
    const actions: CardAction[] = [
      {
        id: "change",
        label: "Change time",
        variant: "secondary",
        onClick: () => setEditing(true),
      },
      {
        id: "cancel",
        label: "Cancel",
        variant: "ghost",
        onClick: () => onCancel(),
      },
    ]
    return (
      <TranscriptActionCard
        title={`Auto-continue at ${displayAt} (${tzLabel})`}
        actions={actions}
      />
    )
  }

  const editActions: CardAction[] = [
    {
      id: "save",
      label: "Save",
      variant: "primary",
      disabled: !isFuture,
      onClick: () => {
        if (parsed !== null) {
          onReschedule(parsed)
          setEditing(false)
        }
      },
    },
    {
      id: "back",
      label: "Back",
      variant: "ghost",
      onClick: () => setEditing(false),
    },
  ]
  return (
    <TranscriptActionCard
      title={`Auto-continue at ${displayAt} (${tzLabel})`}
      body={
        <div className="space-y-1">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="dd/mm/yyyy hh:mm"
          />
          {inputInvalid && <div className="text-destructive text-xs">{inputInvalid}</div>}
        </div>
      }
      actions={editActions}
    />
  )
}
