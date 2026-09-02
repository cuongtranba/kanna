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
