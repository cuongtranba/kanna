import type { InstalledPackage, PackageKind } from "./types"

type InstalledPackageFields = Pick<
  InstalledPackage,
  "source" | "version" | "installedAt" | "updatedAt" | "installPath" | "versionLabel"
> &
  Partial<Pick<InstalledPackage, "sourceUrl" | "revision" | "agents" | "pinnedRef">>

export function installedPackage(kind: PackageKind, key: string, fields: InstalledPackageFields): InstalledPackage {
  return {
    id: `${kind}:${key}`,
    kind,
    name: key,
    sourceUrl: null,
    revision: null,
    agents: [],
    pinnedRef: null,
    ...fields,
  }
}
