import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SegmentedControl } from "../components/ui/segmented-control"
import { draftToEmbedded, embeddedToDraft, problemsOf } from "../lib/serviceBusDraft"
import { selectServiceBusSettings, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useServiceBusSectionStore } from "../stores/serviceBusSectionStore"
import { EMBEDDED_LOG_LEVELS, type EmbeddedLogLevel } from "../../shared/service-bus/jetstream-config"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import type { KannaState } from "./useKannaState"
import { Field, Problems } from "./ServiceBusFields"
import { sendCommandWithFeedback, surfaceErrorIn } from "../lib/commandFeedback"

const SAVE_KEY = pendingActionKey("settings.serviceBus", "embedded")
const RESET_KEY = pendingActionKey("serviceBus.resetStore")

const LOG_LABELS: Record<EmbeddedLogLevel, string> = { info: "Info", debug: "Debug" }
const LOG_OPTIONS = EMBEDDED_LOG_LEVELS.map((value) => ({ value, label: LOG_LABELS[value] }))

export function ServiceBusEmbeddedGroup({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const socket = useOptionalKannaSocket()
  const settings = useAppSettingsStore(selectServiceBusSettings)
  const saved = embeddedToDraft(settings.embedded)
  const draft = useServiceBusSectionStore((s) => s.embedded) ?? saved
  const editEmbedded = useServiceBusSectionStore((s) => s.editEmbedded)
  const discardEmbedded = useServiceBusSectionStore((s) => s.discardEmbedded)
  const resetConfirm = useServiceBusSectionStore((s) => s.resetConfirm)
  const askResetConfirm = useServiceBusSectionStore((s) => s.askResetConfirm)
  const cancelResetConfirm = useServiceBusSectionStore((s) => s.cancelResetConfirm)
  const setError = useServiceBusSectionStore((s) => s.setError)
  const saving = usePendingAction(SAVE_KEY)
  const resetting = usePendingAction(RESET_KEY)

  const next = draftToEmbedded(draft)
  const problems = problemsOf(settings, { embedded: next })
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const edit = (patch: Partial<typeof draft>) => editEmbedded(saved, patch)

  const save = useCallback(() => surfaceErrorIn(setError, async () => {
    await state.handleWriteAppSettings({ serviceBus: { embedded: draftToEmbedded(draft) } })
    discardEmbedded()
  }), [state, draft, discardEmbedded, setError])

  const resetStore = useCallback(async () => {
    await surfaceErrorIn(setError, async () => {
      await sendCommandWithFeedback(socket, { type: "serviceBus.resetStore" })
    })
    cancelResetConfirm()
  }, [socket, cancelResetConfirm, setError])

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Embedded server</summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Memory store (MB)">
            <Input aria-label="Memory store in megabytes" inputMode="numeric" className="tabular-nums" value={draft.maxMemoryStoreMb} onChange={(event) => edit({ maxMemoryStoreMb: event.target.value })} />
          </Field>
          <Field label="File store (MB)">
            <Input aria-label="File store in megabytes" inputMode="numeric" className="tabular-nums" value={draft.maxFileStoreMb} onChange={(event) => edit({ maxFileStoreMb: event.target.value })} />
          </Field>
          <Field label="Port" note="auto picks a free loopback port">
            <Input aria-label="Port" inputMode="numeric" className="tabular-nums" value={draft.port} onChange={(event) => edit({ port: event.target.value })} />
          </Field>
        </div>
        <Field label="Server log level">
          <SegmentedControl size="sm" value={draft.logLevel} onValueChange={(logLevel) => edit({ logLevel })} options={LOG_OPTIONS} />
        </Field>
        <Problems problems={problems} />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={discardEmbedded}>
            Revert
          </Button>
          <Button type="button" size="sm" disabled={!dirty || problems.length > 0} pending={saving} onClick={() => runPendingAction(SAVE_KEY, save)}>
            Save server
          </Button>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="text-13 font-medium text-foreground">Reset store</div>
          <p className="text-13 text-muted-foreground">Stops the embedded server, deletes every message it holds and starts it again. Kanna's own history is not touched.</p>
          {resetConfirm ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" pending={resetting} onClick={() => runPendingAction(RESET_KEY, resetStore)}>
                Delete the store
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={resetting} onClick={cancelResetConfirm}>
                Cancel
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={askResetConfirm}>
                Reset store
              </Button>
            </div>
          )}
        </div>
      </div>
    </details>
  )
}
