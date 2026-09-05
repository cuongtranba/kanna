export type PackageKind = "skill" | "claude-plugin" | "codex-plugin"
export type PackageId = string

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
  currentRevision: string | null
  latestRevision: string | null
  currentVersion: string | null
  latestVersion: string | null
  checkedAt: number
  error: string | null
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
  autoApplyHistory: PackageAutoApplyHistoryEntry[]
}

export interface PackageApplyResult {
  id: PackageId
  ok: boolean
  fromRevision: string | null
  toRevision: string | null
  command: string[]
  stdout: string
  stderr: string
  error: string | null
}

export interface PackageUpdateApplier {
  kind: PackageKind
  apply(pkg: PackageUpdateEntry, signal: AbortSignal): Promise<PackageApplyResult>
}
