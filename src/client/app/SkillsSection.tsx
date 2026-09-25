import { useCallback, useEffect, type ReactNode } from "react"
import { ExternalLink, Loader2, Search, X } from "lucide-react"
import type {
  InstalledSkillSummary,
  InstalledSkillsSnapshot,
  SkillInstallResult,
  SkillSearchResult,
  SkillSearchSnapshot,
  SkillUninstallResult,
} from "../../shared/types"
import type { PackageUpdateEntry } from "../../shared/packages/types"
import type { ClientCommand } from "../../shared/protocol"
import { errorMessage } from "../../shared/errors"
import { Button } from "../components/ui/button"
import { InstalledSkillCard } from "../components/settings/SkillCard"
import { runDetached } from "../lib/runDetached"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useSettingsPageStore } from "../stores/settingsPageStore"
import { timerAdapter } from "../adapters/timer.adapter"
import type { TimerPort } from "../ports/timerPort"
import type { KannaState } from "./useKannaState"

function formatInstallCount(count: number) {
  if (!count || count <= 0) return "0 installs"
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`
  return `${count} install${count === 1 ? "" : "s"}`
}

const CHECK_UPDATES_KEY = pendingActionKey("packages.checkUpdates")
const UPDATE_ALL_KEY = pendingActionKey("packages.updateAll", "skill")

function skillPackageId(skillName: string): string {
  return `skill:${skillName}`
}

function InstalledSkillEntry({
  skill,
  packageEntry,
  uninstalling,
  applying,
  onUninstall,
  onUpdate,
}: {
  skill: InstalledSkillSummary
  packageEntry: PackageUpdateEntry | null
  uninstalling: boolean
  applying: boolean
  onUninstall: (skill: InstalledSkillSummary) => void
  onUpdate: (id: string) => void
}) {
  const packageId = skillPackageId(skill.name)
  const updatePending = usePendingAction(pendingActionKey("packages.update", packageId))
  const uninstallPending = usePendingAction(pendingActionKey("skills.uninstall", skill.name))
  return (
    <InstalledSkillCard
      skill={skill}
      packageEntry={packageEntry}
      uninstalling={uninstalling || uninstallPending}
      applying={applying || updatePending}
      onUninstall={() => onUninstall(skill)}
      onUpdate={() => onUpdate(packageId)}
    />
  )
}

function SkillErrorBlock({ message }: { message: string }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive">
      {message}
    </pre>
  )
}

function SkillResultCard({
  skill,
  installing,
  installed,
  message,
  onInstall,
}: {
  skill: SkillSearchResult
  installing: boolean
  installed: boolean
  message?: string
  onInstall: () => void
}) {
  let buttonLabel: string
  if (installed) {
    buttonLabel = "Installed"
  } else if (installing) {
    buttonLabel = "Installing"
  } else {
    buttonLabel = "Get"
  }
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card/30 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
        <div className="truncate text-xs text-muted-foreground">{skill.source} · {formatInstallCount(skill.installs)}</div>
        {installed && message ? <div className="mt-1 truncate text-xs text-emerald-500">{message}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={`https://skills.sh/${skill.id}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${skill.name} on skills.sh`}
          className="touch-manipulation inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <Button
          type="button"
          size="sm"
          variant={installed ? "secondary" : "default"}
          disabled={installing || installed}
          onClick={onInstall}
          className="h-6 rounded-full px-2 text-xs"
        >
          {installing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}

export function SkillsSection({
  state,
  ports,
}: {
  state: Pick<KannaState, "connectionStatus" | "socket">
  ports?: { timer?: TimerPort }
}) {
  const timer = ports?.timer ?? timerAdapter
  const socket = state.socket
  const connectionStatus = state.connectionStatus
  const query = useSettingsPageStore((s) => s.skillQuery)
  const setQuery = useSettingsPageStore((s) => s.setSkillQuery)
  const results = useSettingsPageStore((s) => s.skillResults)
  const setResults = useSettingsPageStore((s) => s.setSkillResults)
  const searchLoading = useSettingsPageStore((s) => s.skillSearchLoading)
  const setSearchLoading = useSettingsPageStore((s) => s.setSkillSearchLoading)
  const searchError = useSettingsPageStore((s) => s.skillSearchError)
  const setSearchError = useSettingsPageStore((s) => s.setSkillSearchError)
  const installedSkills = useSettingsPageStore((s) => s.installedSkills)
  const setInstalledSkills = useSettingsPageStore((s) => s.setInstalledSkills)
  const installedSkillIds = useSettingsPageStore((s) => s.installedSkillIds)
  const setInstalledSkillIds = useSettingsPageStore((s) => s.setInstalledSkillIds)
  const addInstalledSkillId = useSettingsPageStore((s) => s.addInstalledSkillId)
  const removeInstalledSkillId = useSettingsPageStore((s) => s.removeInstalledSkillId)
  const installedLoading = useSettingsPageStore((s) => s.installedLoading)
  const setInstalledLoading = useSettingsPageStore((s) => s.setInstalledLoading)
  const installedError = useSettingsPageStore((s) => s.installedError)
  const setInstalledError = useSettingsPageStore((s) => s.setInstalledError)
  const operationError = useSettingsPageStore((s) => s.skillOperationError)
  const setOperationError = useSettingsPageStore((s) => s.setSkillOperationError)
  const installingSkillId = useSettingsPageStore((s) => s.installingSkillId)
  const setInstallingSkillId = useSettingsPageStore((s) => s.setInstallingSkillId)
  const uninstallingSkillId = useSettingsPageStore((s) => s.uninstallingSkillId)
  const setUninstallingSkillId = useSettingsPageStore((s) => s.setUninstallingSkillId)
  const installMessages = useSettingsPageStore((s) => s.installMessages)
  const setInstallMessage = useSettingsPageStore((s) => s.setInstallMessage)
  const clearInstallMessage = useSettingsPageStore((s) => s.clearInstallMessage)
  const clearInstallMessagesForSkill = useSettingsPageStore((s) => s.clearInstallMessagesForSkill)
  const packageUpdateSnapshot = useSettingsPageStore((s) => s.packageUpdateSnapshot)

  const isChecking = packageUpdateSnapshot?.status === "checking"
  const bulkUpdatableIds = packageUpdateSnapshot?.packages
    .filter((p) => p.kind === "skill" && !p.pinnedRef)
    .filter((p) => p.update.availability === "outdated" || p.update.availability === "partial")
    .map((p) => p.id) ?? []
  const outdatedCount = bulkUpdatableIds.length
  const lastChecked = packageUpdateSnapshot?.lastCheckedAt
    ? new Date(packageUpdateSnapshot.lastCheckedAt).toLocaleTimeString()
    : null

  const checkPending = usePendingAction(CHECK_UPDATES_KEY)
  const updateAllPending = usePendingAction(UPDATE_ALL_KEY)
  const checking = isChecking || checkPending

  async function sendPackageCommand(command: ClientCommand) {
    try {
      setOperationError(null)
      await socket.command(command)
    } catch (error) {
      setOperationError(errorMessage(error))
      throw error
    }
  }

  function checkUpdates() {
    runPendingAction(CHECK_UPDATES_KEY, () => sendPackageCommand({ type: "packages.checkUpdates" }))
  }

  function updateSkill(id: string) {
    runPendingAction(pendingActionKey("packages.update", id), () => sendPackageCommand({ type: "packages.update", id }))
  }

  function updateAllSkills() {
    if (bulkUpdatableIds.length === 0) return
    runPendingAction(UPDATE_ALL_KEY, () => sendPackageCommand({ type: "packages.updateAll", ids: bulkUpdatableIds }))
  }

  function launchInstallSkill(skill: SkillSearchResult) {
    runPendingAction(pendingActionKey("skills.install", skill.id), () => installSkill(skill))
  }

  function launchUninstallSkill(skill: InstalledSkillSummary) {
    runPendingAction(pendingActionKey("skills.uninstall", skill.name), () => uninstallSkill(skill))
  }

  const loadInstalledSkills = useCallback(async () => {
    if (connectionStatus !== "connected") {
      setInstalledSkills([])
      setInstalledSkillIds(new Set())
      setInstalledError(null)
      setInstalledLoading(false)
      return
    }

    try {
      setInstalledLoading(true)
      setInstalledError(null)
      const snapshot = await socket.command<InstalledSkillsSnapshot>({ type: "skills.listInstalled" })
      setInstalledSkills(snapshot.skills)
      setInstalledSkillIds(new Set(snapshot.skills.map((skill) => skill.name)))
    } catch (error) {
      setInstalledSkills([])
      setInstalledSkillIds(new Set())
      setInstalledError(error instanceof Error ? error.message : "Unable to read installed skills.")
    } finally {
      setInstalledLoading(false)
    }
  }, [connectionStatus, socket, setInstalledSkills, setInstalledSkillIds, setInstalledError, setInstalledLoading])

  useEffect(() => {
    runDetached("skills.listInstalled", loadInstalledSkills())
  }, [connectionStatus, loadInstalledSkills, socket])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 2) {
      setResults([])
      setSearchError(null)
      setSearchLoading(false)
      return
    }

    if (connectionStatus !== "connected") {
      setResults([])
      setSearchLoading(false)
      setSearchError("Backend connection required.")
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)

    const timeout = timer.setTimeout(() => {
      void socket.command<SkillSearchSnapshot>({
        type: "skills.search",
        query: normalizedQuery,
        limit: 100,
      })
        .then((snapshot) => {
          if (cancelled) return
          setResults(snapshot.skills)
        })
        .catch((error) => {
          if (cancelled) return
          setResults([])
          setSearchError(error instanceof Error ? error.message : "Unable to search skills.")
        })
        .finally(() => {
          if (cancelled) return
          setSearchLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      timer.clearTimeout(timeout)
    }
  }, [connectionStatus, query, socket, setResults, setSearchError, setSearchLoading, timer])

  async function installSkill(skill: SkillSearchResult) {
    if (connectionStatus !== "connected") {
      setOperationError("Backend connection required.")
      return
    }

    try {
      setInstallingSkillId(skill.id)
      setOperationError(null)
      clearInstallMessage(skill.id)
      await socket.command<SkillInstallResult>({
        type: "skills.install",
        source: skill.source,
        skillId: skill.skillId,
      })
      addInstalledSkillId(skill.skillId)
      setInstallMessage(skill.id, "Installed globally")
      runDetached("skills.listInstalled", loadInstalledSkills())
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Install failed.")
    } finally {
      setInstallingSkillId(null)
    }
  }

  async function uninstallSkill(skill: InstalledSkillSummary) {
    if (connectionStatus !== "connected") {
      setOperationError("Backend connection required.")
      return
    }

    try {
      setUninstallingSkillId(skill.name)
      setOperationError(null)
      await socket.command<SkillUninstallResult>({
        type: "skills.uninstall",
        skillId: skill.name,
      })
      setInstalledSkills(installedSkills.filter((installedSkill) => installedSkill.name !== skill.name))
      removeInstalledSkillId(skill.name)
      clearInstallMessagesForSkill(skill.name)
      runDetached("skills.listInstalled", loadInstalledSkills())
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Uninstall failed.")
    } finally {
      setUninstallingSkillId(null)
    }
  }

  let installedContent: ReactNode
  if (installedSkills.length > 0) {
    installedContent = (
      <div className="grid gap-3 md:grid-cols-2">
        {installedSkills.map((skill) => (
          <InstalledSkillEntry
            key={`${skill.source}/${skill.name}`}
            skill={skill}
            packageEntry={packageUpdateSnapshot?.packages.find((p) => p.kind === "skill" && p.name === skill.name) ?? null}
            uninstalling={uninstallingSkillId === skill.name}
            applying={packageUpdateSnapshot?.applying.includes(skillPackageId(skill.name)) ?? false}
            onUninstall={launchUninstallSkill}
            onUpdate={updateSkill}
          />
        ))}
      </div>
    )
  } else if (!installedLoading) {
    installedContent = (
      <div className="rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground">
        No global skills installed.
      </div>
    )
  } else {
    installedContent = null
  }
  return (
    <div className="flex flex-col gap-6">
      {operationError ? <SkillErrorBlock message={operationError} /> : null}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">Installed</div>
          <div className="flex items-center gap-2">
            {lastChecked ? <span className="tabular-nums text-xs text-muted-foreground">Checked {lastChecked}</span> : null}
            {outdatedCount > 0 ? (
              <Button size="sm" variant="secondary" className="h-6 rounded-full px-2 text-xs" pending={updateAllPending} onClick={updateAllSkills}>Update all ({outdatedCount})</Button>
            ) : null}
            <Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" disabled={checking} aria-busy={checking || undefined} onClick={checkUpdates}>
              {checking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Check
            </Button>
            {installedLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>
        {installedError ? <div className="text-xs text-destructive">{installedError}</div> : null}
        {installedContent}
      </section>

      <section className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">Discover</div>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear skills search"
              onClick={() => setQuery("")}
              className="touch-manipulation inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {searchLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </div>
        {searchError ? <div className="text-xs text-destructive">{searchError}</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((skill) => (
            <SkillResultCard
              key={skill.id}
              skill={skill}
              installing={installingSkillId === skill.id}
              installed={installedSkillIds.has(skill.skillId)}
              message={installMessages[skill.id]}
              onInstall={() => { launchInstallSkill(skill) }}
            />
          ))}
        </div>
        {!searchLoading && !searchError && query.trim().length >= 2 && results.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/30 p-3 text-sm text-muted-foreground">
            No skills found.
          </div>
        ) : null}
      </section>
    </div>
  )
}

