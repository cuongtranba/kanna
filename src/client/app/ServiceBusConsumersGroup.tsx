import { useCallback } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import {
  CONSUMER_ACK_POLICIES,
  CONSUMER_DELIVER_POLICIES,
  type ConsumerAckPolicy,
  type ConsumerDeliverPolicy,
  type JetStreamConsumerSettings,
} from "../../shared/service-bus/jetstream-config"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SegmentedControl } from "../components/ui/segmented-control"
import { consumerToDraft, draftToConsumer, newConsumerDraft, problemsOf } from "../lib/serviceBusDraft"
import { selectServiceBusSettings, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useServiceBusStore } from "../stores/serviceBusStore"
import { useServiceBusSectionStore } from "../stores/serviceBusSectionStore"
import { surfaceErrorIn } from "../lib/commandFeedback"
import type { KannaState } from "./useKannaState"
import { Field, Problems } from "./ServiceBusFields"

const SAVE_KEY = pendingActionKey("settings.serviceBus", "consumers")

const ACK_LABELS: Record<ConsumerAckPolicy, string> = { explicit: "Explicit", all: "All", none: "None" }
const ACK_OPTIONS = CONSUMER_ACK_POLICIES.map((value) => ({ value, label: ACK_LABELS[value] }))
const DELIVER_LABELS: Record<ConsumerDeliverPolicy, string> = { all: "All", new: "New", last: "Last" }
const DELIVER_OPTIONS = CONSUMER_DELIVER_POLICIES.map((value) => ({ value, label: DELIVER_LABELS[value] }))

function ConsumerRow({ consumer, onEdit, onRemove }: { consumer: JetStreamConsumerSettings; onEdit: () => void; onRemove: () => void }) {
  const live = useServiceBusStore((s) => s.status.consumers.find((candidate) => candidate.name === consumer.durableName))
  const removing = usePendingAction(pendingActionKey("settings.serviceBus", "consumer", consumer.durableName))
  return (
    <li className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{consumer.durableName}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {consumer.filterSubject || "all subjects"} · ack {consumer.ackPolicy} · deliver {consumer.deliverPolicy}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {live ? `${String(live.pending)} pending · ${String(live.ackPending)} ack pending` : "not reported yet"}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${consumer.durableName}`} onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${consumer.durableName}`} pending={removing} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  )
}

export function ServiceBusConsumersGroup({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const settings = useAppSettingsStore(selectServiceBusSettings)
  const editor = useServiceBusSectionStore((s) => s.consumerEditor)
  const openConsumerEditor = useServiceBusSectionStore((s) => s.openConsumerEditor)
  const editConsumer = useServiceBusSectionStore((s) => s.editConsumer)
  const closeConsumerEditor = useServiceBusSectionStore((s) => s.closeConsumerEditor)
  const setError = useServiceBusSectionStore((s) => s.setError)
  const saving = usePendingAction(SAVE_KEY)

  const write = useCallback(
    (consumers: JetStreamConsumerSettings[]) => surfaceErrorIn(setError, async () => {
      await state.handleWriteAppSettings({ serviceBus: { consumers } })
      closeConsumerEditor()
    }),
    [state, closeConsumerEditor, setError],
  )

  const candidate = editor ? draftToConsumer(editor.draft) : null
  const editedName = editor?.target.kind === "edit" ? editor.target.durableName : null
  const others = settings.consumers.filter((consumer) => consumer.durableName !== editedName)
  const problems = candidate ? problemsOf(settings, { consumers: [...others, candidate] }) : []

  const saveEditor = useCallback(async () => {
    if (candidate === null) return
    const next = settings.consumers.map((consumer) => (consumer.durableName === editedName ? candidate : consumer))
    await write(editedName === null ? [...settings.consumers, candidate] : next)
  }, [candidate, editedName, settings.consumers, write])

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
        Consumers <span className="font-mono text-xs tabular-nums text-muted-foreground">{settings.consumers.length}</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border py-3">
        <p className="px-4 text-13 text-muted-foreground">
          Durable pull consumers Kanna creates on the stream. Kanna removes only the ones it created, and never touches consumers you add elsewhere.
        </p>
        {settings.consumers.length === 0 ? (
          <div className="px-4 text-13 text-muted-foreground">No consumers configured</div>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {settings.consumers.map((consumer) => (
              <ConsumerRow
                key={consumer.durableName}
                consumer={consumer}
                onEdit={() => openConsumerEditor({ kind: "edit", durableName: consumer.durableName }, consumerToDraft(consumer))}
                onRemove={() =>
                  runPendingAction(pendingActionKey("settings.serviceBus", "consumer", consumer.durableName), () =>
                    write(settings.consumers.filter((candidateConsumer) => candidateConsumer.durableName !== consumer.durableName)),
                  )
                }
              />
            ))}
          </ul>
        )}
        {editor ? (
          <div className="mx-4 flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Durable name">
                <Input aria-label="Durable name" value={editor.draft.durableName} disabled={editedName !== null} onChange={(event) => editConsumer({ durableName: event.target.value })} spellCheck={false} />
              </Field>
              <Field label="Filter subject" note="Leave empty for every subject in the stream">
                <Input aria-label="Filter subject" value={editor.draft.filterSubject} onChange={(event) => editConsumer({ filterSubject: event.target.value })} spellCheck={false} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Acknowledgement" note={editedName === null ? undefined : "Cannot change on an existing consumer; remove and add it again"}>
                <SegmentedControl size="sm" value={editor.draft.ackPolicy} onValueChange={(ackPolicy) => editConsumer({ ackPolicy })} options={ACK_OPTIONS} />
              </Field>
              <Field label="Deliver">
                <SegmentedControl size="sm" value={editor.draft.deliverPolicy} onValueChange={(deliverPolicy) => editConsumer({ deliverPolicy })} options={DELIVER_OPTIONS} />
              </Field>
              <Field label="Max ack pending">
                <Input aria-label="Max ack pending" inputMode="numeric" className="tabular-nums" value={editor.draft.maxAckPending} onChange={(event) => editConsumer({ maxAckPending: event.target.value })} />
              </Field>
              <Field label="Ack wait (s)">
                <Input aria-label="Ack wait in seconds" inputMode="numeric" className="tabular-nums" value={editor.draft.ackWaitSec} onChange={(event) => editConsumer({ ackWaitSec: event.target.value })} />
              </Field>
            </div>
            <Problems problems={problems} />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={closeConsumerEditor}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={problems.length > 0} pending={saving} onClick={() => runPendingAction(SAVE_KEY, saveEditor)}>
                Save consumer
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-4">
            <Button type="button" variant="outline" size="sm" onClick={() => openConsumerEditor({ kind: "new" }, newConsumerDraft(settings.stream.subjectPrefix))}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add consumer
            </Button>
          </div>
        )}
      </div>
    </details>
  )
}
