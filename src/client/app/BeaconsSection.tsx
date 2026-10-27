import { useCallback, useMemo, type ChangeEvent } from "react"
import { ArrowUpCircle, Check, ChevronDown, Copy, ExternalLink, Plus, Radio, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "../components/ui/button"
import { Spinner } from "../components/ui/spinner"
import { StateMarkLabel } from "../components/ui/state-mark"
import { HoverHint } from "../components/ui/truncated-text"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import { useNow } from "../hooks/useNow"
import { formatCompactDuration, formatCountdown } from "../lib/formatDuration"
import { beaconUpdateLabel, beaconUpdateTone, isBeaconUpdateInFlight } from "../lib/beaconUpdateStatus"
import { useAppSettingsStore, selectCustomBeacons } from "../stores/appSettingsStore"
import { useBeaconsSectionStore } from "../stores/beaconsSectionStore"
import { selectBeaconRows, useBeaconsStore } from "../stores/beaconsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { copyWithFeedback, useCopied } from "../stores/copyFeedbackStore"
import type { BeaconConfig, BeaconMintResult, BeaconUpdateResult } from "../../shared/beacon-config"
import type { BeaconScope } from "../../shared/beacon-scope"
import { beaconDisplayName } from "../../shared/beacon-alias"
import { BEACON_DOWNLOAD_PAGE, buildBeaconPairLink } from "../../shared/beacon-pair-link"
import { isBeaconBehind, type BeaconStatusRow } from "../../shared/beacon-status"
import { STATUS_PILL_CLASS } from "../../shared/design/tone-pairings"
import { APP_VERSION } from "../../shared/branding"
import { cn } from "../lib/utils"
import type { ClipboardPort } from "../ports/clipboardPort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { clipboardAdapter } from "../adapters/clipboard.adapter"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { BeaconAliasEditButton, BeaconAliasForm } from "./BeaconAliasEditor"
import { BeaconScopeEditor } from "./BeaconScopeEditor"
import type { KannaState } from "./useKannaState"


const MINT_KEY = pendingActionKey("beacons.mintPairingCode")

export interface BeaconsSectionHandlers {
  onMint: () => Promise<BeaconMintResult>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onSetScope: (id: string, scope: BeaconScope) => Promise<void>
  onSetAlias: (id: string, alias: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string) => Promise<BeaconUpdateResult>
}

interface BeaconsSectionProps {
  rows: readonly BeaconStatusRow[]
  configs: readonly BeaconConfig[]
  handlers: BeaconsSectionHandlers
  serverVersion?: string
  dom?: DomPort
  clipboard?: ClipboardPort
  timer?: TimerPort
}

export function mergeBeaconRows(
  rows: readonly BeaconStatusRow[],
  configs: readonly BeaconConfig[],
): readonly BeaconStatusRow[] {
  const liveById = new Map(rows.map((row) => [row.id, row]))
  return configs.map((config) => {
    const live = liveById.get(config.id)
    return {
      id: config.id,
      label: config.label,
      alias: config.alias ?? null,
      os: config.os,
      enabled: config.enabled,
      online: live?.online ?? false,
      lastSeenAt: live?.lastSeenAt ?? null,
      beaconVersion: live?.beaconVersion ?? null,
      canSelfUpdate: live?.canSelfUpdate ?? false,
      update: live?.update ?? null,
    }
  })
}

export function BeaconsSection({
  rows,
  configs,
  handlers,
  serverVersion,
  dom = domAdapter,
  clipboard = clipboardAdapter,
  timer = timerAdapter,
}: BeaconsSectionProps) {
  const now = useNow(1_000)
  const merged = useMemo(() => mergeBeaconRows(rows, configs), [rows, configs])
  const configsById = useMemo(() => new Map(configs.map((config) => [config.id, config])), [configs])

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <PairingPanel now={now} handlers={handlers} dom={dom} clipboard={clipboard} timer={timer} />
      {merged.length === 0 ? (
        <SettingsEmptyState
          icon={Radio}
          message="No machines paired yet. Pair a machine to let the agent read files and run approved commands there."
        />
      ) : (
        <SettingsList>
          {merged.map((row) => (
            <BeaconRow
              key={row.id}
              row={row}
              scope={configsById.get(row.id)?.scope ?? null}
              now={now}
              serverVersion={serverVersion}
              handlers={handlers}
              dom={dom}
            />
          ))}
        </SettingsList>
      )}
    </div>
  )
}

function PairingPanel({
  now,
  handlers,
  dom,
  clipboard,
  timer,
}: {
  now: number
  handlers: BeaconsSectionHandlers
  dom: DomPort
  clipboard: ClipboardPort
  timer: TimerPort
}) {
  const pairing = useBeaconsSectionStore((s) => s.pairing)
  const setPairing = useBeaconsSectionStore((s) => s.setPairing)
  const minting = usePendingAction(MINT_KEY)

  const onMint = useCallback(() => {
    runPendingAction(MINT_KEY, async () => {
      setPairing(await handlers.onMint())
    })
  }, [handlers, setPairing])

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Beacons</h2>
          <p className="mt-1 text-13 text-muted-foreground">
            A beacon is a small program on your own machine. Once paired, the agent can read files and run
            commands there, only within the scope you grant below.
          </p>
        </div>
        <Button size="sm" variant={pairing?.ok === true ? "secondary" : "default"} onClick={onMint} pending={minting}>
          <Plus className="mr-1 h-4 w-4" />
          Pair a machine
        </Button>
      </div>
      {pairing?.ok === false && (
        <p role="alert" className="text-sm text-destructive-text">
          {pairing.error}
        </p>
      )}
      {pairing?.ok === true && (
        <PairingCode
          code={pairing.code}
          expiresAt={pairing.expiresAt}
          now={now}
          dom={dom}
          clipboard={clipboard}
          timer={timer}
        />
      )}
    </div>
  )
}

function PairingCode({
  code,
  expiresAt,
  now,
  dom,
  clipboard,
  timer,
}: {
  code: string
  expiresAt: number
  now: number
  dom: DomPort
  clipboard: ClipboardPort
  timer: TimerPort
}) {
  const remaining = expiresAt - now
  const origin = dom.getOrigin()
  const command = `kanna-beacon pair ${origin} ${code}`
  const appLink = buildBeaconPairLink({ kannaUrl: origin, code })
  const copyKey = pendingActionKey("beacons.copyPairCommand", code)
  const copying = usePendingAction(copyKey)
  const copied = useCopied(copyKey)

  const onCopy = useCallback(() => {
    runPendingAction(copyKey, () => copyWithFeedback(copyKey, () => clipboard.writeText(command), timer))
  }, [clipboard, command, copyKey, timer])

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xl font-medium tabular-nums tracking-widest">{code}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {remaining > 0 ? `Expires in ${formatCountdown(remaining)}` : "Expired. Pair again for a new code."}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={appLink} className={buttonVariants({ size: "sm" })}>
          <ExternalLink className="mr-1 h-4 w-4" />
          Open in Kanna Beacon
        </a>
        <a
          href={BEACON_DOWNLOAD_PAGE}
          target="_blank"
          rel="noreferrer"
          className="text-13 text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Download Kanna Beacon
        </a>
      </div>
      <p className="text-13 text-muted-foreground">Or run this on the machine you want to pair:</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-13">
          {command}
        </code>
        <HoverHint label={copied ? "Copied" : "Copy command"}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCopy}
            pending={copying}
            aria-label={copied ? "Copied" : "Copy pairing command"}
          >
            {copied ? <Check className="h-4 w-4 text-success-text" /> : <Copy className="h-4 w-4" />}
          </Button>
        </HoverHint>
      </div>
    </div>
  )
}

function lastSeenLabel(row: BeaconStatusRow, now: number): string {
  if (row.lastSeenAt === null) return "Never connected"
  return `Last seen ${formatCompactDuration(now - row.lastSeenAt)} ago`
}

const MANUAL_REINSTALL_HINT =
  "This beacon is too old to update itself. Reinstall it once from the download page; after that, updates are one click."

function UpdateAvailablePill({ canSelfUpdate }: { canSelfUpdate: boolean }) {
  const pillClass = cn("rounded-full border px-2 py-0.5 text-xs", STATUS_PILL_CLASS.outdated)
  if (canSelfUpdate) return <span className={pillClass}>Update available</span>
  return (
    <HoverHint label={MANUAL_REINSTALL_HINT}>
      <a href={BEACON_DOWNLOAD_PAGE} target="_blank" rel="noreferrer" className={pillClass}>
        Update available
      </a>
    </HoverHint>
  )
}

function BeaconUpdateControls({
  row,
  updateAvailable,
  handlers,
}: {
  row: BeaconStatusRow
  updateAvailable: boolean
  handlers: BeaconsSectionHandlers
}) {
  const updateKey = pendingActionKey("beacons.update", row.id)
  const updatePending = usePendingAction(updateKey)
  const updateError = useBeaconsSectionStore((s) => s.updateErrors[row.id] ?? null)
  const setUpdateError = useBeaconsSectionStore((s) => s.setUpdateError)
  const canUpdateNow = updateAvailable && row.online && row.canSelfUpdate && !isBeaconUpdateInFlight(row.update)

  const onUpdate = useCallback(() => {
    runPendingAction(updateKey, async () => {
      const result = await handlers.onUpdate(row.id)
      setUpdateError(row.id, result.ok ? null : result.error)
    })
  }, [handlers, row.id, setUpdateError, updateKey])

  return (
    <>
      {row.update !== null && <StateMarkLabel tone={beaconUpdateTone(row.update)} label={beaconUpdateLabel(row.update)} />}
      {canUpdateNow && (
        <Button variant="secondary" size="sm" onClick={onUpdate} pending={updatePending} aria-label={`Update ${beaconDisplayName(row)} now`}>
          <ArrowUpCircle className="mr-1 h-4 w-4" />
          Update now
        </Button>
      )}
      {updateError !== null && (
        <span role="alert" className="text-destructive-text">
          {updateError}
        </span>
      )}
    </>
  )
}

function BeaconRow({
  row,
  scope,
  now,
  serverVersion,
  handlers,
  dom,
}: {
  row: BeaconStatusRow
  scope: BeaconScope | null
  now: number
  serverVersion: string | undefined
  handlers: BeaconsSectionHandlers
  dom: DomPort
}) {
  const expanded = useBeaconsSectionStore((s) => s.expandedId === row.id)
  const toggleExpanded = useBeaconsSectionStore((s) => s.toggleExpanded)
  const enabledKey = pendingActionKey("beacons.setEnabled", row.id)
  const enabledPending = usePendingAction(enabledKey)
  const deleteKey = pendingActionKey("beacons.delete", row.id)
  const deletePending = usePendingAction(deleteKey)

  const displayName = beaconDisplayName(row)
  const updateAvailable =
    row.beaconVersion !== null && serverVersion !== undefined && isBeaconBehind(row.beaconVersion, serverVersion)

  const onToggleEnabled = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked
    runPendingAction(enabledKey, () => handlers.onSetEnabled(row.id, enabled))
  }, [enabledKey, handlers, row.id])

  const onRevoke = useCallback(() => {
    if (dom.confirmDialog(`Revoke "${displayName}"? The agent will lose access to this machine until you pair it again.`)) {
      runPendingAction(deleteKey, () => handlers.onDelete(row.id))
    }
  }, [deleteKey, displayName, dom, handlers, row.id])

  const onToggleScope = useCallback(() => {
    toggleExpanded(row.id)
  }, [row.id, toggleExpanded])

  return (
    <li className="flex flex-col" aria-busy={deletePending || undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-medium">{displayName}</span>
            <BeaconAliasEditButton beaconId={row.id} alias={row.alias} displayName={displayName} />
          </span>
          {row.alias !== null && (
            <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">{row.label}</span>
              <span className="font-mono">@beacon/{row.alias}</span>
            </span>
          )}
          <BeaconAliasForm beaconId={row.id} alias={row.alias} displayName={displayName} onSetAlias={handlers.onSetAlias} />
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StateMarkLabel tone={row.online ? "active" : "muted"} label={row.online ? "Online" : "Offline"} />
            <span className="tabular-nums">{lastSeenLabel(row, now)}</span>
            {row.beaconVersion !== null && <span className="font-mono tabular-nums">v{row.beaconVersion}</span>}
            {updateAvailable && <UpdateAvailablePill canSelfUpdate={row.canSelfUpdate} />}
            <BeaconUpdateControls row={row} updateAvailable={updateAvailable} handlers={handlers} />
            <span>{row.os}</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
            {enabledPending ? <Spinner /> : null}
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={enabledPending}
              aria-busy={enabledPending || undefined}
              onChange={onToggleEnabled}
              aria-label={`Enable ${displayName}`}
            />
            <span>{row.enabled ? "Enabled" : "Disabled"}</span>
          </label>
          {scope !== null && (
            <Button variant="ghost" size="sm" onClick={onToggleScope} aria-expanded={expanded}>
              Scope
              <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", expanded && "rotate-180")} />
            </Button>
          )}
          <HoverHint label="Revoke this machine">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRevoke}
              pending={deletePending}
              aria-label={`Revoke ${displayName}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </HoverHint>
        </div>
      </div>
      {expanded && scope !== null && (
        <BeaconScopeEditor beaconId={row.id} scope={scope} onSetScope={handlers.onSetScope} />
      )}
    </li>
  )
}

export function BeaconsSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings" | "handleMintBeaconPairingCode" | "handleUpdateBeacon">
}) {
  const rows = useBeaconsStore(selectBeaconRows)
  const configs = useAppSettingsStore(selectCustomBeacons)
  const { handleWriteAppSettings, handleMintBeaconPairingCode, handleUpdateBeacon } = props.state

  const handlers = useMemo<BeaconsSectionHandlers>(
    () => ({
      onMint: handleMintBeaconPairingCode,
      onSetEnabled: async (id, enabled) => {
        await handleWriteAppSettings({ customBeacons: { setEnabled: { id, enabled } } })
      },
      onSetScope: async (id, scope) => {
        await handleWriteAppSettings({ customBeacons: { setScope: { id, scope } } })
      },
      onSetAlias: async (id, alias) => {
        await handleWriteAppSettings({ customBeacons: { update: { id, patch: { alias } } } })
      },
      onDelete: async (id) => {
        await handleWriteAppSettings({ customBeacons: { delete: { id } } })
      },
      onUpdate: handleUpdateBeacon,
    }),
    [handleWriteAppSettings, handleMintBeaconPairingCode, handleUpdateBeacon],
  )

  return <BeaconsSection rows={rows} configs={configs} handlers={handlers} serverVersion={APP_VERSION} />
}
