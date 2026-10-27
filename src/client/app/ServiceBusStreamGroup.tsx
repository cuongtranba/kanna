import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SegmentedControl } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { draftToStream, lowersLimits, problemsOf, recreateFields, sameStream, streamToDraft } from "../lib/serviceBusDraft"
import { selectServiceBusSettings, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useServiceBusSectionStore } from "../stores/serviceBusSectionStore"
import { surfaceErrorIn } from "../lib/commandFeedback"
import type { KannaState } from "./useKannaState"
import { Field, Problems } from "./ServiceBusFields"

const SAVE_KEY = pendingActionKey("settings.serviceBus", "stream")
const RECREATE_NOTE = "Changing this requires recreating the stream"
const LOWER_NOTE = "Lowering this drops older messages"

const RETENTION_OPTIONS = [
  { value: "limits" as const, label: "Limits" },
  { value: "interest" as const, label: "Interest" },
  { value: "workqueue" as const, label: "Work queue" },
]
const STORAGE_OPTIONS = [
  { value: "file" as const, label: "File" },
  { value: "memory" as const, label: "Memory" },
]
const DISCARD_OPTIONS = [
  { value: "old" as const, label: "Oldest" },
  { value: "new" as const, label: "Newest" },
]

export function ServiceBusStreamGroup({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const settings = useAppSettingsStore(selectServiceBusSettings)
  const saved = streamToDraft(settings.stream)
  const draft = useServiceBusSectionStore((s) => s.stream) ?? saved
  const editStream = useServiceBusSectionStore((s) => s.editStream)
  const discardStream = useServiceBusSectionStore((s) => s.discardStream)
  const setError = useServiceBusSectionStore((s) => s.setError)
  const saving = usePendingAction(SAVE_KEY)

  const next = draftToStream(draft)
  const problems = problemsOf(settings, { stream: next })
  const dirty = !sameStream(settings.stream, draft)
  const recreate = recreateFields(settings.stream, next)
  const lowers = lowersLimits(settings.stream, next)
  const edit = (patch: Partial<typeof draft>) => editStream(saved, patch)

  const save = useCallback(() => surfaceErrorIn(setError, async () => {
    await state.handleWriteAppSettings({ serviceBus: { stream: draftToStream(draft) } })
    discardStream()
  }), [state, draft, discardStream, setError])

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Stream</summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Stream name">
            <Input aria-label="Stream name" value={draft.name} onChange={(event) => edit({ name: event.target.value })} spellCheck={false} />
          </Field>
          <Field label="Subject prefix" note={`Kanna publishes under ${draft.subjectPrefix || "…"}.>`}>
            <Input aria-label="Subject prefix" value={draft.subjectPrefix} onChange={(event) => edit({ subjectPrefix: event.target.value })} spellCheck={false} />
          </Field>
        </div>
        <Field label="Extra subjects" note="One per line; the stream also captures these">
          <Textarea aria-label="Extra subjects" rows={2} value={draft.extraSubjects} onChange={(event) => edit({ extraSubjects: event.target.value })} spellCheck={false} />
        </Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Retention" note={RECREATE_NOTE} warn={recreate.includes("retention")}>
            <SegmentedControl size="sm" value={draft.retention} onValueChange={(retention) => edit({ retention })} options={RETENTION_OPTIONS} />
          </Field>
          <Field label="Storage" note={RECREATE_NOTE} warn={recreate.includes("storage")}>
            <SegmentedControl size="sm" value={draft.storage} onValueChange={(storage) => edit({ storage })} options={STORAGE_OPTIONS} />
          </Field>
          <Field label="Replicas" note={RECREATE_NOTE} warn={recreate.includes("replicas")}>
            <Input aria-label="Replicas" inputMode="numeric" className="tabular-nums" value={draft.replicas} onChange={(event) => edit({ replicas: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Max age (days)" note={LOWER_NOTE} warn={lowers}>
            <Input aria-label="Max age in days" inputMode="numeric" className="tabular-nums" value={draft.maxAgeDays} onChange={(event) => edit({ maxAgeDays: event.target.value })} />
          </Field>
          <Field label="Max bytes (MB)" note={LOWER_NOTE} warn={lowers}>
            <Input aria-label="Max bytes in megabytes" inputMode="numeric" className="tabular-nums" value={draft.maxBytesMb} onChange={(event) => edit({ maxBytesMb: event.target.value })} />
          </Field>
          <Field label="Max messages" note="-1 means unlimited">
            <Input aria-label="Max messages" inputMode="numeric" className="tabular-nums" value={draft.maxMsgs} onChange={(event) => edit({ maxMsgs: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="When full, discard">
            <SegmentedControl size="sm" value={draft.discard} onValueChange={(discard) => edit({ discard })} options={DISCARD_OPTIONS} />
          </Field>
          <Field label="Duplicate window (s)" note="Messages with the same id inside this window are stored once">
            <Input aria-label="Duplicate window in seconds" inputMode="numeric" className="tabular-nums" value={draft.duplicateWindowSec} onChange={(event) => edit({ duplicateWindowSec: event.target.value })} />
          </Field>
        </div>
        <Problems problems={problems} />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={discardStream}>
            Revert
          </Button>
          <Button type="button" size="sm" disabled={!dirty || problems.length > 0} pending={saving} onClick={() => runPendingAction(SAVE_KEY, save)}>
            Save stream
          </Button>
        </div>
      </div>
    </details>
  )
}
