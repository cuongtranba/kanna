import { useCallback, useEffect, type ReactNode } from "react"
import { ExternalLink, Loader2, Search, X } from "lucide-react"
import type {
  InstalledSkillSummary,
  SkillSearchResult,
} from "../../shared/types"
import type { PackageUpdateEntry } from "../../shared/packages/types"
import type { ClientCommand } from "../../shared/protocol"
import { errorMessage } from "../../shared/errors"
import { Button } from "../components/ui/button"
import { InstalledSkillCard } from "../components/settings/SkillCard"
import { runDetached } from "../lib/runDetached"
import { pendingActionKey, runPendingAction, usePendingAction, usePendingActionsStore } from "../stores/pendingActionsStore"
import { usePackageInventoryStore } from "../stores/packageInventoryStore"
import { useSkillsSectionStore } from "../stores/skillsSectionStore"
import { timerAdapter } from "../adapters/timer.adapter"
import type { TimerPort } from "../ports/timerPort"
import type { KannaState } from "./useKannaState"

function installSkillKey(skillId: string): string {
  return pendingActionKey("skills.install", skillId)
}

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
  applying,
  onUninstall,
  onUpdate,
}: {
  skill: InstalledSkillSummary
  packageEntry: PackageUpdateEntry | null
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
      uninstalling={uninstallPending}
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
  const query = useSkillsSectionStore((s) => s.query)
  const setQuery = useSkillsSectionStore((s) => s.setQuery)
  const results = useSkillsSectionStore((s) => s.results)
  const searchLoading = useSkillsSectionStore((s) => s.searchLoading)
  const searchError = useSkillsSectionStore((s) => s.searchError)
  const searchCleared = useSkillsSectionStore((s) => s.searchCleared)
  const searchStarted = useSkillsSectionStore((s) => s.searchStarted)
  const searchSucceeded = useSkillsSectionStore((s) => s.searchSucceeded)
  const searchFailed = useSkillsSectionStore((s) => s.searchFailed)
  const installedSkills = useSkillsSectionStore((s) => s.installedSkills)
  const installedSkillIds = useSkillsSectionStore((s) => s.installedSkillIds)
  const installedLoading = useSkillsSectionStore((s) => s.installedLoading)
  const installedError = useSkillsSectionStore((s) => s.installedError)
  const installedCleared = useSkillsSectionStore((s) => s.installedCleared)
  const installedLoadStarted = useSkillsSectionStore((s) => s.installedLoadStarted)
  const installedLoaded = useSkillsSectionStore((s) => s.installedLoaded)
  const installedLoadFailed = useSkillsSectionStore((s) => s.installedLoadFailed)
  const installedLoadFinished = useSkillsSectionStore((s) => s.installedLoadFinished)
  const operationError = useSkillsSectionStore((s) => s.operationError)
  const setOperationError = useSkillsSectionStore((s) => s.setOperationError)
  const pendingActions = usePendingActionsStore((s) => s.inFlight)
  const installMessages = useSkillsSectionStore((s) => s.installMessages)
  const installStarted = useSkillsSectionStore((s) => s.installStarted)
  const installSucceeded = useSkillsSectionStore((s) => s.installSucceeded)
  const uninstallSucceeded = useSkillsSectionStore((s) => s.uninstallSucceeded)
  const packageUpdateSnapshot = usePackageInventoryStore((s) => s.updateSnapshot)

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
    runPendingAction(installSkillKey(skill.id), () => installSkill(skill))
  }

  function launchUninstallSkill(skill: InstalledSkillSummary) {
    runPendingAction(pendingActionKey("skills.uninstall", skill.name), () => uninstallSkill(skill))
  }

  const loadInstalledSkills = useCallback(async () => {
    if (connectionStatus !== "connected") {
      installedCleared()
      return
    }

    try {
      installedLoadStarted()
      const snapshot = await socket.command({ type: "skills.listInstalled" })
      installedLoaded(snapshot.skills)
    } catch (error) {
      installedLoadFailed(errorMessage(error))
    } finally {
      installedLoadFinished()
    }
  }, [connectionStatus, socket, installedCleared, installedLoadStarted, installedLoaded, installedLoadFailed, installedLoadFinished])

  useEffect(() => {
    runDetached("skills.listInstalled", loadInstalledSkills())
  }, [connectionStatus, loadInstalledSkills, socket])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 2) {
      searchCleared(null)
      return
    }

    if (connectionStatus !== "connected") {
      searchCleared("Backend connection required.")
      return
    }

    let cancelled = false
    searchStarted()

    const timeout = timer.setTimeout(() => {
      void socket.command({
        type: "skills.search",
        query: normalizedQuery,
        limit: 100,
      })
        .then((snapshot) => {
          if (cancelled) return
          searchSucceeded(snapshot.skills)
        })
        .catch((error) => {
          if (cancelled) return
          searchFailed(errorMessage(error))
        })
    }, 250)

    return () => {
      cancelled = true
      timer.clearTimeout(timeout)
    }
  }, [connectionStatus, query, socket, searchCleared, searchStarted, searchSucceeded, searchFailed, timer])

  async function installSkill(skill: SkillSearchResult) {
    if (connectionStatus !== "connected") {
      setOperationError("Backend connection required.")
      return
    }

    try {
      installStarted(skill.skillId)
      await socket.command({
        type: "skills.install",
        source: skill.source,
        skillId: skill.skillId,
      })
      installSucceeded(skill.skillId)
      runDetached("skills.listInstalled", loadInstalledSkills())
    } catch (error) {
      setOperationError(errorMessage(error))
    }
  }

  async function uninstallSkill(skill: InstalledSkillSummary) {
    if (connectionStatus !== "connected") {
      setOperationError("Backend connection required.")
      return
    }

    try {
      setOperationError(null)
      await socket.command({
        type: "skills.uninstall",
        skillId: skill.name,
      })
      uninstallSucceeded(skill.name)
      runDetached("skills.listInstalled", loadInstalledSkills())
    } catch (error) {
      setOperationError(errorMessage(error))
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
              installing={pendingActions[installSkillKey(skill.id)] === true}
              installed={installedSkillIds.has(skill.skillId)}
              message={installMessages[skill.skillId]}
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

