/**
 * Settings -> Skills section, extracted verbatim from `SettingsPage.tsx`.
 *
 * The move is behaviour-preserving: `SkillsSection` and its three private
 * helpers (`formatInstallCount`, `SkillErrorBlock`, `SkillResultCard`) are
 * unchanged, and `SettingsPage.tsx` now imports the section instead of
 * declaring it. The extraction pays for the Plugins settings row: the page is
 * pinned at an exact `MODULE_ALLOWANCES` ceiling with no headroom, so a new
 * section can only be added by first moving an existing one out.
 */
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
import { Button } from "../components/ui/button"
import { InstalledSkillCard } from "../components/settings/SkillCard"
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
  // "Update all" covers only what a plain `skills update` can actually move. A
  // pinned skill needs its pin REPLACED, which is a per-card decision the user
  // makes by name — a bulk button must never do it silently.
  const bulkUpdatableIds = packageUpdateSnapshot?.packages
    .filter((p) => p.kind === "skill" && !p.pinnedRef)
    .filter((p) => p.update.availability === "outdated" || p.update.availability === "partial")
    .map((p) => p.id) ?? []
  const outdatedCount = bulkUpdatableIds.length
  const lastChecked = packageUpdateSnapshot?.lastCheckedAt
    ? new Date(packageUpdateSnapshot.lastCheckedAt).toLocaleTimeString()
    : null

  function checkUpdates() {
    void socket.command({ type: "packages.checkUpdates" })
  }

  function updateSkill(id: string) {
    void socket.command({ type: "packages.update", id })
  }

  function updateAllSkills() {
    if (bulkUpdatableIds.length > 0) {
      void socket.command({ type: "packages.updateAll", ids: bulkUpdatableIds })
    }
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
    void loadInstalledSkills()
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
      void loadInstalledSkills()
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
      void loadInstalledSkills()
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
          <InstalledSkillCard
            key={`${skill.source}/${skill.name}`}
            skill={skill}
            packageEntry={packageUpdateSnapshot?.packages.find((p) => p.kind === "skill" && p.name === skill.name) ?? null}
            uninstalling={uninstallingSkillId === skill.name}
            applying={packageUpdateSnapshot?.applying.includes(`skill:${skill.name}`) ?? false}
            onUninstall={() => { void uninstallSkill(skill) }}
            onUpdate={() => { updateSkill(`skill:${skill.name}`) }}
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
              <Button size="sm" variant="secondary" className="h-6 rounded-full px-2 text-xs" onClick={() => { updateAllSkills() }}>Update all ({outdatedCount})</Button>
            ) : null}
            <Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" disabled={isChecking} onClick={checkUpdates}>
              {isChecking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Check
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
              onInstall={() => { void installSkill(skill) }}
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

