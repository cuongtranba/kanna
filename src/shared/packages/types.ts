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
  currentVersion: string | null // null for skills
  latestVersion: string | null
  checkedAt: number
  error: string | null // why `unknown`; rendered, never swallowed
}

export interface PackageUpdateEntry extends InstalledPackage {
  update: PackageUpdateStatus
}

export interface PackageUpdateSnapshot {
  status: "idle" | "checking" | "applying"
  packages: PackageUpdateEntry[]
  lastCheckedAt: number | null
  error: string | null
  applying: PackageId[]
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
  apply(pkg: InstalledPackage, signal: AbortSignal): Promise<PackageApplyResult>
}
