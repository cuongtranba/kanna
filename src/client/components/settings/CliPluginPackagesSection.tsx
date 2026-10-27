import { type ReactNode, useCallback, useEffect } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "../ui/button"
import { AvailabilityPill, UpdateActionButton, updateActionLabel } from "./PackageUpdateBadge"
import { errorMessage } from "../../../shared/errors"
import type { InstalledPackage, PackageKind, PackageUpdateEntry } from "../../../shared/packages/types"
import { runDetached } from "../../lib/runDetached"
import { sendCommandWithFeedback } from "../../lib/commandFeedback"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import { usePackageInventoryStore } from "../../stores/packageInventoryStore"
import type { KannaState } from "../../app/useKannaState"

const CHECK_UPDATES_KEY = pendingActionKey("packages.checkUpdates")

function packageUpdateKey(id: string): string {
  return pendingActionKey("packages.update", id)
}

const EMPTY_PACKAGES: InstalledPackage[] = []
const EMPTY_ERRORS: Array<{ kind: PackageKind; message: string }> = []
const EMPTY_UPDATE_ENTRIES: PackageUpdateEntry[] = []
const EMPTY_APPLYING: string[] = []

function PluginRow({
  pkg,
  packageEntry,
  applying,
  onUpdate,
}: {
  pkg: InstalledPackage
  packageEntry: PackageUpdateEntry | null
  applying: boolean
  onUpdate: () => void
}) {
  const updatePending = usePendingAction(packageUpdateKey(pkg.id))
  const updating = applying || updatePending
  const version = pkg.versionLabel ?? pkg.version ?? pkg.revision?.slice(0, 7) ?? null
  const action = updateActionLabel(packageEntry)

  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-card/30 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{pkg.name}</div>
        {version ? <div className="font-mono tabular-nums text-xs text-muted-foreground/70">{version}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <AvailabilityPill availability={packageEntry?.update.availability} />
        {action ? <UpdateActionButton label={action} updating={updating} onClick={onUpdate} /> : null}
        {pkg.sourceUrl ? (
          <a
            href={pkg.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${pkg.name} source`}
            className="touch-manipulation inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function MarketplaceGroup({
  source,
  packages,
  updateEntries,
  applying,
  isChecking,
  onCheckUpdates,
  onUpdate,
}: {
  source: string
  packages: InstalledPackage[]
  updateEntries: PackageUpdateEntry[]
  applying: readonly string[]
  isChecking: boolean
  onCheckUpdates: () => void
  onUpdate: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-muted-foreground">{source}</div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-full px-2 text-xs"
          disabled={isChecking}
          aria-busy={isChecking || undefined}
          onClick={onCheckUpdates}
        >
          {isChecking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Refresh
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {packages.map((pkg) => {
          const entry = updateEntries.find((e) => e.id === pkg.id) ?? null
          return (
            <PluginRow
              key={pkg.id}
              pkg={pkg}
              packageEntry={entry}
              applying={applying.includes(pkg.id)}
              onUpdate={() => onUpdate(pkg.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function PluginKindSection({
  label,
  kind,
  packages,
  errors,
  updateEntries,
  applying,
  isChecking,
  onCheckUpdates,
  onUpdate,
}: {
  label: string
  kind: PackageKind
  packages: InstalledPackage[]
  errors: Array<{ kind: PackageKind; message: string }>
  updateEntries: PackageUpdateEntry[]
  applying: readonly string[]
  isChecking: boolean
  onCheckUpdates: () => void
  onUpdate: (id: string) => void
}) {
  const kindError = errors.find((e) => e.kind === kind)
  const kindPackages = packages.filter((p) => p.kind === kind)

  const bySource = new Map<string, InstalledPackage[]>()
  for (const pkg of kindPackages) {
    const source = pkg.source || "Unknown"
    const list = bySource.get(source)
    if (list) list.push(pkg)
    else bySource.set(source, [pkg])
  }

  const cliName = kind === "claude-plugin" ? "Claude Code CLI" : "Codex CLI"

  let body: ReactNode
  if (kindError) {
    body = (
      <div className="rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground">
        {cliName} not found — install it to manage {label} plugins.
      </div>
    )
  } else if (kindPackages.length === 0) {
    body = (
      <div className="rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground">
        No {label} plugins installed.
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {[...bySource.entries()].map(([source, pkgs]) => (
          <MarketplaceGroup
            key={source}
            source={source}
            packages={pkgs}
            updateEntries={updateEntries}
            applying={applying}
            isChecking={isChecking}
            onCheckUpdates={onCheckUpdates}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {body}
    </section>
  )
}

export function CliPluginPackagesSection({
  state,
}: {
  state: Pick<KannaState, "connectionStatus" | "socket">
}) {
  const { socket, connectionStatus } = state

  const pluginInventory = usePackageInventoryStore((s) => s.inventory)
  const pluginInventoryLoading = usePackageInventoryStore((s) => s.loading)
  const pluginInventoryError = usePackageInventoryStore((s) => s.error)
  const inventoryCleared = usePackageInventoryStore((s) => s.inventoryCleared)
  const inventoryLoadStarted = usePackageInventoryStore((s) => s.inventoryLoadStarted)
  const inventoryLoaded = usePackageInventoryStore((s) => s.inventoryLoaded)
  const inventoryLoadFailed = usePackageInventoryStore((s) => s.inventoryLoadFailed)
  const inventoryLoadFinished = usePackageInventoryStore((s) => s.inventoryLoadFinished)
  const packageUpdateSnapshot = usePackageInventoryStore((s) => s.updateSnapshot)

  const loadPlugins = useCallback(async () => {
    if (connectionStatus !== "connected") {
      inventoryCleared()
      return
    }
    try {
      inventoryLoadStarted()
      inventoryLoaded(await socket.command({ type: "packages.listInstalled" }))
    } catch (err) {
      inventoryLoadFailed(errorMessage(err))
    } finally {
      inventoryLoadFinished()
    }
  }, [connectionStatus, socket, inventoryCleared, inventoryLoadStarted, inventoryLoaded, inventoryLoadFailed, inventoryLoadFinished])

  useEffect(() => {
    runDetached("packages.listInstalled", loadPlugins())
  }, [loadPlugins])

  const checkUpdates = useCallback(() => {
    runPendingAction(CHECK_UPDATES_KEY, () => sendCommandWithFeedback(socket, { type: "packages.checkUpdates" }))
  }, [socket])

  const updatePlugin = useCallback(
    (id: string) => {
      runPendingAction(packageUpdateKey(id), () => sendCommandWithFeedback(socket, { type: "packages.update", id }))
    },
    [socket],
  )

  const checkPending = usePendingAction(CHECK_UPDATES_KEY)
  const isChecking = packageUpdateSnapshot?.status === "checking" || checkPending
  const applying = packageUpdateSnapshot?.applying ?? EMPTY_APPLYING
  const pluginUpdateEntries = packageUpdateSnapshot?.packages.filter(
    (p) => p.kind === "claude-plugin" || p.kind === "codex-plugin",
  ) ?? EMPTY_UPDATE_ENTRIES
  const allPackages = pluginInventory?.packages ?? EMPTY_PACKAGES
  const allErrors = pluginInventory?.errors ?? EMPTY_ERRORS

  if (pluginInventoryError) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {pluginInventoryError}
      </div>
    )
  }

  if (pluginInventoryLoading && !pluginInventory) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PluginKindSection
        label="Claude Code"
        kind="claude-plugin"
        packages={allPackages}
        errors={allErrors}
        updateEntries={pluginUpdateEntries}
        applying={applying}
        isChecking={isChecking}
        onCheckUpdates={checkUpdates}
        onUpdate={updatePlugin}
      />
      <PluginKindSection
        label="Codex"
        kind="codex-plugin"
        packages={allPackages}
        errors={allErrors}
        updateEntries={pluginUpdateEntries}
        applying={applying}
        isChecking={isChecking}
        onCheckUpdates={checkUpdates}
        onUpdate={updatePlugin}
      />
    </div>
  )
}
