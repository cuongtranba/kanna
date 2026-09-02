import { type ReactNode, useCallback, useEffect } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "../ui/button"
import { STATUS_PILL_CLASS } from "../../../shared/design/tone-pairings"
import type { InstalledPackage, PackageInventorySnapshot, PackageKind, PackageUpdateEntry, UpdateAvailability } from "../../../shared/packages/types"
import { cn } from "../../lib/utils"
import { useSettingsPageStore } from "../../stores/settingsPageStore"
import type { KannaState } from "../../app/useKannaState"

// Module-level stable empty refs
const EMPTY_PACKAGES: InstalledPackage[] = []
const EMPTY_ERRORS: Array<{ kind: PackageKind; message: string }> = []
const EMPTY_UPDATE_ENTRIES: PackageUpdateEntry[] = []
const EMPTY_APPLYING: string[] = []

function isPackageInventorySnapshot<T>(v: T): v is T & PackageInventorySnapshot {
  return typeof v === "object" && v !== null && "packages" in v && "errors" in v
}

const AVAILABILITY_LABEL: Record<UpdateAvailability, string> = {
  up_to_date: "Up to date",
  outdated: "Outdated",
  partial: "Partial",
  unknown: "Unknown",
}

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
  const avail = packageEntry?.update.availability
  const version = pkg.versionLabel ?? pkg.version ?? pkg.revision?.slice(0, 7) ?? null
  const pillClass = avail && avail !== "up_to_date" ? STATUS_PILL_CLASS[avail] : null

  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-card/30 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{pkg.name}</div>
        {version ? <div className="font-mono tabular-nums text-xs text-muted-foreground/70">{version}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {pillClass ? (
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", pillClass)}>
            {AVAILABILITY_LABEL[avail!]}
          </span>
        ) : null}
        {avail === "outdated" || avail === "partial" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={applying}
            onClick={onUpdate}
            className="h-6 rounded-full px-2 text-xs"
          >
            {applying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Update
          </Button>
        ) : null}
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

export function PluginsSection({
  state,
}: {
  state: Pick<KannaState, "connectionStatus" | "socket">
}) {
  const { socket, connectionStatus } = state

  const pluginInventory = useSettingsPageStore((s) => s.pluginInventory)
  const pluginInventoryLoading = useSettingsPageStore((s) => s.pluginInventoryLoading)
  const pluginInventoryError = useSettingsPageStore((s) => s.pluginInventoryError)
  const setPluginInventory = useSettingsPageStore((s) => s.setPluginInventory)
  const setPluginInventoryLoading = useSettingsPageStore((s) => s.setPluginInventoryLoading)
  const setPluginInventoryError = useSettingsPageStore((s) => s.setPluginInventoryError)
  const packageUpdateSnapshot = useSettingsPageStore((s) => s.packageUpdateSnapshot)

  const loadPlugins = useCallback(async () => {
    if (connectionStatus !== "connected") {
      setPluginInventory(null)
      setPluginInventoryError(null)
      setPluginInventoryLoading(false)
      return
    }
    try {
      setPluginInventoryLoading(true)
      setPluginInventoryError(null)
      const raw = await socket.command({ type: "packages.listInstalled" })
      if (!isPackageInventorySnapshot(raw)) throw new Error("packages.listInstalled: unexpected response")
      const inv = raw
      setPluginInventory(inv)
    } catch (err) {
      setPluginInventoryError(err instanceof Error ? err.message : "Unable to load plugins.")
    } finally {
      setPluginInventoryLoading(false)
    }
  }, [connectionStatus, socket, setPluginInventory, setPluginInventoryLoading, setPluginInventoryError])

  useEffect(() => {
    void loadPlugins()
  }, [loadPlugins])

  const checkUpdates = useCallback(() => {
    void socket.command({ type: "packages.checkUpdates" })
  }, [socket])

  const updatePlugin = useCallback(
    (id: string) => {
      void socket.command({ type: "packages.update", id })
    },
    [socket],
  )

  const isChecking = packageUpdateSnapshot?.status === "checking"
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
