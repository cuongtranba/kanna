export type PackageKind = "skill" | "claude-plugin" | "codex-plugin"
export type PackageId = string // `${kind}:${name}`

export interface InstalledPackage {
  id: PackageId
  kind: PackageKind
  name: string
  source: string
  sourceUrl: string | null
  version: string | null
  revision: string | null
  installedAt: string | null
  updatedAt: string | null
  installPath: string | null
  versionLabel: string | null
  agents: string[]
  /**
   * The git ref this package is pinned to (skill lock `ref`), or null when it
   * tracks the default branch.
   *
   * Load-bearing: `skills update` resolves upstream AT THIS REF, so a pinned
   * package can never be moved by an update — it exits 0 having changed
   * nothing. Anything offering an update affordance must consult this, or it
   * offers a button that provably cannot work.
   */
  pinnedRef: string | null
}

export interface PackageInventorySnapshot {
  packages: InstalledPackage[]
  errors: Array<{ kind: PackageKind; message: string }>
  readAt: number
}

export interface PackageUpdateChecker {
  kind: PackageKind
  check(pkgs: readonly InstalledPackage[], signal: AbortSignal): Promise<PackageUpdateStatus[]>
}

export type UpdateAvailability = "up_to_date" | "outdated" | "partial" | "unknown"

export interface PackageUpdateStatus {
  id: PackageId
  availability: UpdateAvailability
  currentRevision: string | null // lock's skillFolderHash
  latestRevision: string | null // upstream tree sha
  currentVersion: string | null // for skills: the pinned ref, else null
  latestVersion: string | null // for skills: the tag to re-pin to, else null
  checkedAt: number
  error: string | null // why `unknown`; rendered, never swallowed
}

export interface PackageUpdateEntry extends InstalledPackage {
  update: PackageUpdateStatus
}

export interface PackageAutoApplyHistoryEntry {
  id: PackageId
  kind: PackageKind
  name: string
  appliedAt: number
  ok: boolean
  fromRevision: string | null
  toRevision: string | null
  error: string | null
}

export interface PackageUpdateSnapshot {
  status: "idle" | "checking" | "applying"
  packages: PackageUpdateEntry[]
  lastCheckedAt: number | null
  error: string | null
  applying: PackageId[]
  /** Most recent auto-apply results, newest first. Capped at 50 entries. */
  autoApplyHistory: PackageAutoApplyHistoryEntry[]
}

export interface PackageApplyResult {
  id: PackageId
  ok: boolean
  /** Revision before the apply (from lock / installed_plugins.json). */
  fromRevision: string | null
  /** Revision after the apply (re-read from disk after the CLI exits). */
  toRevision: string | null
  command: string[]
  stdout: string
  stderr: string
  error: string | null
}

export interface PackageUpdateApplier {
  kind: PackageKind
  /**
   * Takes the whole entry, not just the InstalledPackage, so an applier can
   * read the check result that selected it — the skill applier needs
   * `update.latestVersion` to build a re-pin command. The manager already had
   * the entry in hand; widening the type here avoids threading a second
   * argument through every call site for one applier's benefit.
   */
  apply(pkg: PackageUpdateEntry, signal: AbortSignal): Promise<PackageApplyResult>
}
