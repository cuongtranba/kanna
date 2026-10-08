import { useCallback, useMemo, type ChangeEvent } from "react"
import { Check, Copy, ExternalLink, Plus, Radio, Trash2, X } from "lucide-react"
import { Button, buttonVariants } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Spinner } from "../components/ui/spinner"
import { StateMarkLabel } from "../components/ui/state-mark"
import { HoverHint } from "../components/ui/truncated-text"
import { SettingsEmptyState, SettingsList } from "../components/settings/SettingsList"
import { useNow } from "../hooks/useNow"
import { formatCompactDuration, formatCountdown } from "../lib/formatDuration"
import { useAppSettingsStore, selectCustomBeacons } from "../stores/appSettingsStore"
import { beaconDraftKey, useBeaconsSectionStore } from "../stores/beaconsSectionStore"
import { selectBeaconRows, useBeaconsStore } from "../stores/beaconsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { copyWithFeedback, useCopied } from "../stores/copyFeedbackStore"
import type { BeaconConfig, BeaconMintResult } from "../../shared/beacon-config"
import type { BeaconScope } from "../../shared/beacon-scope"
import { BEACON_DOWNLOAD_PAGE, buildBeaconPairLink } from "../../shared/beacon-pair-link"
import { buildBeaconStatusRows, isBeaconBehind, type BeaconStatusRow } from "../../shared/beacon-status"
import { STATUS_PILL_CLASS } from "../../shared/design/tone-pairings"
import { SDK_CLIENT_APP } from "../../shared/branding"
import { cn } from "../lib/utils"
import type { ClipboardPort } from "../ports/clipboardPort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { clipboardAdapter } from "../adapters/clipboard.adapter"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import type { KannaState } from "./useKannaState"

const SERVER_VERSION = SDK_CLIENT_APP.split("/")[1]

const MINT_KEY = pendingActionKey("beacons.mintPairingCode")

export interface BeaconsSectionHandlers {
  onMint: () => Promise<BeaconMintResult>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onSetScope: (id: string, scope: BeaconScope) => Promise<void>
  onDelete: (id: string) => Promise<void>
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
  const known = new Set(rows.map((row) => row.id))
  const missing = configs.filter((config) => !known.has(config.id))
  if (missing.length === 0) return rows
  return [...rows, ...buildBeaconStatusRows(missing, [])]
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

  const updateAvailable =
    row.beaconVersion !== null && serverVersion !== undefined && isBeaconBehind(row.beaconVersion, serverVersion)

  const onToggleEnabled = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked
    runPendingAction(enabledKey, () => handlers.onSetEnabled(row.id, enabled))
  }, [enabledKey, handlers, row.id])

  const onRevoke = useCallback(() => {
    if (dom.confirmDialog(`Revoke "${row.label}"? The agent will lose access to this machine until you pair it again.`)) {
      runPendingAction(deleteKey, () => handlers.onDelete(row.id))
    }
  }, [deleteKey, dom, handlers, row.id, row.label])

  const onToggleScope = useCallback(() => {
    toggleExpanded(row.id)
  }, [row.id, toggleExpanded])

  return (
    <li className="flex flex-col" aria-busy={deletePending || undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium">{row.label}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StateMarkLabel tone={row.online ? "active" : "muted"} label={row.online ? "Online" : "Offline"} />
            <span className="tabular-nums">{lastSeenLabel(row, now)}</span>
            {row.beaconVersion !== null && <span className="font-mono tabular-nums">v{row.beaconVersion}</span>}
            {updateAvailable && (
              <span className={cn("rounded-full border px-2 py-0.5 text-xs", STATUS_PILL_CLASS.outdated)}>
                Update available
              </span>
            )}
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
              aria-label={`Enable ${row.label}`}
            />
            <span>{row.enabled ? "Enabled" : "Disabled"}</span>
          </label>
          {scope !== null && (
            <Button variant="ghost" size="sm" onClick={onToggleScope} aria-expanded={expanded}>
              Scope
            </Button>
          )}
          <HoverHint label="Revoke this machine">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRevoke}
              pending={deletePending}
              aria-label={`Revoke ${row.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </HoverHint>
        </div>
      </div>
      {expanded && scope !== null && <ScopeEditor beaconId={row.id} scope={scope} handlers={handlers} />}
    </li>
  )
}

function ScopeEditor({
  beaconId,
  scope,
  handlers,
}: {
  beaconId: string
  scope: BeaconScope
  handlers: BeaconsSectionHandlers
}) {
  const scopeKey = pendingActionKey("beacons.setScope", beaconId)
  const pending = usePendingAction(scopeKey)

  const commit = useCallback((next: BeaconScope) => {
    runPendingAction(scopeKey, () => handlers.onSetScope(beaconId, next))
  }, [beaconId, handlers, scopeKey])

  const onExec = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    commit({ ...scope, exec: event.target.checked })
  }, [commit, scope])

  const onAutoRun = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    commit({ ...scope, autoRunScripts: event.target.checked })
  }, [commit, scope])

  const onReadRoots = useCallback((readRoots: readonly string[]) => {
    commit({ ...scope, readRoots })
  }, [commit, scope])

  const onAllowlist = useCallback((execAllowlist: readonly string[]) => {
    commit({ ...scope, execAllowlist })
  }, [commit, scope])

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-4 py-4" aria-busy={pending || undefined}>
      <ScopeToggle
        checked={scope.exec}
        disabled={pending}
        onChange={onExec}
        title="Allow running commands"
        description="Without this, the agent can only read files inside the folders below."
      />
      <ScopeToggle
        checked={scope.autoRunScripts}
        disabled={pending}
        onChange={onAutoRun}
        title="Run commands and scripts from this chat without asking each time"
        description="Reads inside your folders and commands you have enabled run immediately, with no approval prompt."
      />
      <ScopeList
        label="Folders the agent may read"
        placeholder="/Users/me/projects"
        draftKey={beaconDraftKey(beaconId, "readRoots")}
        items={scope.readRoots}
        disabled={pending}
        onChange={onReadRoots}
      />
      <ScopeList
        label="Commands that always run without asking"
        placeholder="git"
        draftKey={beaconDraftKey(beaconId, "execAllowlist")}
        items={scope.execAllowlist}
        disabled={pending}
        onChange={onAllowlist}
      />
    </div>
  )
}

function ScopeToggle({
  checked,
  disabled,
  onChange,
  title,
  description,
}: {
  checked: boolean
  disabled: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  title: string
  description: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-13 text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

function ScopeList({
  label,
  placeholder,
  draftKey,
  items,
  disabled,
  onChange,
}: {
  label: string
  placeholder: string
  draftKey: string
  items: readonly string[]
  disabled: boolean
  onChange: (items: readonly string[]) => void
}) {
  const draft = useBeaconsSectionStore((s) => s.drafts[draftKey] ?? "")
  const setDraft = useBeaconsSectionStore((s) => s.setDraft)
  const clearDraft = useBeaconsSectionStore((s) => s.clearDraft)
  const value = draft.trim()
  const canAdd = value.length > 0 && !items.includes(value)

  const onDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(draftKey, event.target.value)
  }, [draftKey, setDraft])

  const onAdd = useCallback(() => {
    onChange([...items, value])
    clearDraft(draftKey)
  }, [clearDraft, draftKey, items, onChange, value])

  const onRemove = useCallback((item: string) => {
    onChange(items.filter((entry) => entry !== item))
  }, [items, onChange])

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {items.length === 0 ? (
        <span className="text-13 text-muted-foreground">None</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <ScopeListItem key={item} item={item} disabled={disabled} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input value={draft} onChange={onDraft} placeholder={placeholder} disabled={disabled} aria-label={label} />
        <Button variant="secondary" size="sm" onClick={onAdd} disabled={disabled || !canAdd}>
          Add
        </Button>
      </div>
    </div>
  )
}

function ScopeListItem({
  item,
  disabled,
  onRemove,
}: {
  item: string
  disabled: boolean
  onRemove: (item: string) => void
}) {
  const onClick = useCallback(() => {
    onRemove(item)
  }, [item, onRemove])

  return (
    <li className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-13">
        {item}
      </code>
      <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={`Remove ${item}`}>
        <X className="h-4 w-4" />
      </Button>
    </li>
  )
}

export function BeaconsSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings" | "handleMintBeaconPairingCode">
}) {
  const rows = useBeaconsStore(selectBeaconRows)
  const configs = useAppSettingsStore(selectCustomBeacons)
  const { handleWriteAppSettings, handleMintBeaconPairingCode } = props.state

  const handlers = useMemo<BeaconsSectionHandlers>(
    () => ({
      onMint: handleMintBeaconPairingCode,
      onSetEnabled: async (id, enabled) => {
        await handleWriteAppSettings({ customBeacons: { setEnabled: { id, enabled } } })
      },
      onSetScope: async (id, scope) => {
        await handleWriteAppSettings({ customBeacons: { setScope: { id, scope } } })
      },
      onDelete: async (id) => {
        await handleWriteAppSettings({ customBeacons: { delete: { id } } })
      },
    }),
    [handleWriteAppSettings, handleMintBeaconPairingCode],
  )

  return <BeaconsSection rows={rows} configs={configs} handlers={handlers} serverVersion={SERVER_VERSION} />
}
