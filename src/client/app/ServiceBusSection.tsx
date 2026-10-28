import { useCallback } from "react"
import { StateMarkLabel } from "../components/ui/state-mark"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { PendingSegmentedControl } from "./PendingSegmentedControl"
import { serviceBusStateLabel, serviceBusStateTone } from "../lib/serviceBusView"
import { formatByteSize } from "../lib/formatByteSize"
import { selectServiceBusSettings, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { selectServiceBusStatus, useServiceBusStore } from "../stores/serviceBusStore"
import { useServiceBusSectionStore } from "../stores/serviceBusSectionStore"
import { surfaceErrorIn } from "../lib/commandFeedback"
import { problemsOf } from "../lib/serviceBusDraft"
import { NATS_SERVER_VERSION, SERVICE_BUS_MODES, type ServiceBusMode } from "../../shared/service-bus/jetstream-config"
import type { KannaState } from "./useKannaState"
import { SettingsRow } from "../components/settings/SettingsList"
import { Fact, Field, Problems } from "./ServiceBusFields"
import { ServiceBusConsumersGroup } from "./ServiceBusConsumersGroup"
import { ServiceBusEmbeddedGroup } from "./ServiceBusEmbeddedGroup"
import { ServiceBusStreamGroup } from "./ServiceBusStreamGroup"

const ENABLED_KEY = pendingActionKey("settings.serviceBus", "enabled")
const MODE_KEY = pendingActionKey("settings.serviceBus", "mode")
const START_KEY = pendingActionKey("settings.serviceBus", "start")
const CONNECTION_KEY = pendingActionKey("settings.serviceBus", "connection")
const TOKEN_KEY = pendingActionKey("settings.serviceBus", "token")

const ENABLED_OPTIONS = [
  { value: "enabled" as const, label: "Enabled" },
  { value: "disabled" as const, label: "Disabled" },
]
const MODE_LABELS: Record<ServiceBusMode, string> = { embedded: "Embedded", external: "External" }
const MODE_OPTIONS = SERVICE_BUS_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))

type ServiceBusSectionState = Pick<KannaState, "handleWriteAppSettings">

function StatusFacts() {
  const status = useServiceBusStore(selectServiceBusStatus)
  const count = (value: number) => value.toLocaleString("en-US")
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
      {status.stream ? (
        <>
          <Fact label="Messages" value={count(status.stream.messages)} />
          <Fact label="Size" value={formatByteSize(status.stream.bytes)} />
          <Fact label="First seq" value={count(status.stream.firstSeq)} />
          <Fact label="Last seq" value={count(status.stream.lastSeq)} />
        </>
      ) : null}
      <Fact label="Published" value={count(status.published)} />
      <Fact label="Dropped" value={count(status.dropped)} />
      <Fact label="Queued" value={count(status.queued)} />
      {status.serverVersion ? <Fact label="Server" value={`v${status.serverVersion}${status.port ? ` · :${String(status.port)}` : ""}`} /> : null}
    </dl>
  )
}

function ConnectionSettings({ state }: { state: ServiceBusSectionState }) {
  const settings = useAppSettingsStore(selectServiceBusSettings)
  const draft = useServiceBusSectionStore((s) => s.connection) ?? { url: settings.url, token: "" }
  const editConnection = useServiceBusSectionStore((s) => s.editConnection)
  const discardConnection = useServiceBusSectionStore((s) => s.discardConnection)
  const setError = useServiceBusSectionStore((s) => s.setError)
  const saving = usePendingAction(CONNECTION_KEY)
  const tokenSaving = usePendingAction(TOKEN_KEY)

  const url = draft.url.trim()
  const problems = problemsOf({ ...settings, mode: "external" }, { url })
  const urlDirty = url !== settings.url

  const saveUrl = useCallback(() => surfaceErrorIn(setError, async () => {
    await state.handleWriteAppSettings({ serviceBus: { url } })
    discardConnection()
  }), [state, url, discardConnection, setError])

  const writeToken = useCallback(
    (token: string | null) => surfaceErrorIn(setError, async () => {
      await state.handleWriteAppSettings({ serviceBus: { token } })
      discardConnection()
    }),
    [state, discardConnection, setError],
  )

  const base = { url: settings.url, token: "" }
  return (
    <div className="flex flex-col gap-4 border-t border-border py-5">
      <Field label="Server URL" note="Where your own nats-server listens, for example nats://nats.internal:4222">
        <div className="flex items-center gap-2">
          <Input aria-label="Server URL" value={draft.url} onChange={(event) => editConnection(base, { url: event.target.value })} spellCheck={false} />
          <Button type="button" size="sm" disabled={!urlDirty || problems.length > 0} pending={saving} onClick={() => runPendingAction(CONNECTION_KEY, saveUrl)}>
            Save
          </Button>
        </div>
      </Field>
      <Field label="Token" note={settings.tokenHint ? `A token ending in ${settings.tokenHint} is stored. Kanna never shows it again.` : "No token stored"}>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Token"
            type="password"
            autoComplete="off"
            value={draft.token}
            placeholder={settings.tokenHint ? "Enter a new token to replace it" : "Token"}
            onChange={(event) => editConnection(base, { token: event.target.value })}
          />
          <Button type="button" size="sm" disabled={draft.token.trim() === ""} pending={tokenSaving} onClick={() => runPendingAction(TOKEN_KEY, () => writeToken(draft.token.trim()))}>
            Replace token
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={settings.tokenHint === null} onClick={() => runPendingAction(TOKEN_KEY, () => writeToken(null))}>
            Clear
          </Button>
        </div>
      </Field>
      <Problems problems={problems} />
    </div>
  )
}

export function ServiceBusSection({ state }: { state: ServiceBusSectionState }) {
  const settings = useAppSettingsStore(selectServiceBusSettings)
  const status = useServiceBusStore(selectServiceBusStatus)
  const error = useServiceBusSectionStore((s) => s.error)
  const setError = useServiceBusSectionStore((s) => s.setError)
  const starting = usePendingAction(START_KEY)

  const write = useCallback(
    (patch: { enabled?: boolean; mode?: ServiceBusMode }) => surfaceErrorIn(setError, () => state.handleWriteAppSettings({ serviceBus: patch })),
    [state, setError],
  )

  const setEnabled = useCallback((value: "enabled" | "disabled") => write({ enabled: value === "enabled" }), [write])
  const setMode = useCallback((mode: ServiceBusMode) => write({ mode }), [write])
  const startOrRetry = useCallback(async () => {
    if (settings.enabled) await write({ enabled: false })
    await write({ enabled: true })
  }, [settings.enabled, write])

  const embedded = settings.mode === "embedded"
  const canStart = embedded && (!settings.enabled || status.state === "error")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 pb-2">
        <h2 className="text-base font-medium">Service bus</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Mirror every durable event Kanna records into a NATS JetStream stream, so other programs can read them with the nats CLI or any NATS client. Kanna&apos;s own history is not affected, and a bus outage never blocks a chat.
        </p>
        <p className="max-w-[65ch] text-13 text-muted-foreground">
          {`Embedded mode downloads nats-server v${NATS_SERVER_VERSION} from GitHub on first start and runs it on loopback with a private token.`}
        </p>
      </div>

      <div className="border-b border-border">
        <SettingsRow title="Mirror to NATS" description="When off, nothing is downloaded, started or published.">
          <PendingSegmentedControl pendingKey={ENABLED_KEY} value={settings.enabled ? "enabled" : "disabled"} onValueChange={setEnabled} options={ENABLED_OPTIONS} size="sm" />
        </SettingsRow>
        <SettingsRow title="Server" description="Embedded runs a nats-server that Kanna manages. External connects to one you run.">
          <PendingSegmentedControl pendingKey={MODE_KEY} value={settings.mode} onValueChange={setMode} options={MODE_OPTIONS} size="sm" />
        </SettingsRow>
        <SettingsRow
          title="Status"
          description={status.lastError ? <span className="text-destructive-text">{status.lastError}</span> : "Live state of the mirror."}
          alignStart
        >
          <div className="flex items-center gap-3">
            <StateMarkLabel tone={serviceBusStateTone(status.state)} label={serviceBusStateLabel(status.state)} />
            {canStart ? (
              <Button type="button" size="sm" pending={starting} onClick={() => runPendingAction(START_KEY, startOrRetry)}>
                {settings.enabled ? "Retry" : "Install & start"}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      </div>

      {error ? <div className="text-xs text-destructive-text" role="alert">{error}</div> : null}

      {settings.enabled || status.state !== "disabled" ? (
        <div className="py-3">
          <StatusFacts />
        </div>
      ) : null}

      {embedded ? null : <ConnectionSettings state={state} />}

      <div className="flex flex-col gap-3 pt-2">
        <ServiceBusStreamGroup state={state} />
        <ServiceBusConsumersGroup state={state} />
        {embedded ? <ServiceBusEmbeddedGroup state={state} /> : null}
      </div>
    </div>
  )
}
