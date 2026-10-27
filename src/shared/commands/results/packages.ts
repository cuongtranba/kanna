import { z } from "zod"
import {
  PACKAGE_KINDS,
  type PackageApplyResult,
  type PackageInventorySnapshot,
  type PackageUpdateSnapshot,
} from "../../packages/types"
import type {
  InstalledSkillsSnapshot,
  SkillInstallResult,
  SkillSearchSnapshot,
  SkillUninstallResult,
} from "../../types"
import { assertParity } from "../../type-parity"

export const skillSearchSnapshotSchema = z.object({
  query: z.string(),
  searchType: z.string(),
  skills: z.array(z.object({
    id: z.string(),
    skillId: z.string(),
    name: z.string(),
    installs: z.number(),
    source: z.string(),
  })),
  count: z.number(),
  duration_ms: z.number(),
})

export const skillInstallResultSchema = z.object({
  source: z.string(),
  skillId: z.string(),
  command: z.array(z.string()),
  cwd: z.string(),
  stdout: z.string(),
  stderr: z.string(),
})

export const skillUninstallResultSchema = z.object({
  skillId: z.string(),
  command: z.array(z.string()),
  cwd: z.string(),
  stdout: z.string(),
  stderr: z.string(),
})

export const installedSkillsSnapshotSchema = z.object({
  lockFilePath: z.string(),
  skills: z.array(z.object({
    name: z.string(),
    source: z.string(),
    sourceType: z.string(),
    sourceUrl: z.string(),
    skillPath: z.string().optional(),
    installedAt: z.string(),
    updatedAt: z.string(),
    pluginName: z.string().optional(),
  })),
})

const packageKindSchema = z.enum(PACKAGE_KINDS)

const installedPackageShape = {
  id: z.string(),
  kind: packageKindSchema,
  name: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  version: z.string().nullable(),
  revision: z.string().nullable(),
  installedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  installPath: z.string().nullable(),
  versionLabel: z.string().nullable(),
  agents: z.array(z.string()),
  pinnedRef: z.string().nullable(),
}

export const packageInventorySnapshotSchema = z.object({
  packages: z.array(z.object(installedPackageShape)),
  errors: z.array(z.object({ kind: packageKindSchema, message: z.string() })),
  readAt: z.number(),
})

const packageUpdateStatusSchema = z.object({
  id: z.string(),
  availability: z.enum(["up_to_date", "outdated", "partial", "unknown"]),
  currentRevision: z.string().nullable(),
  latestRevision: z.string().nullable(),
  currentVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  checkedAt: z.number(),
  error: z.string().nullable(),
})

export const packageUpdateSnapshotSchema = z.object({
  status: z.enum(["idle", "checking", "applying"]),
  packages: z.array(z.object({ ...installedPackageShape, update: packageUpdateStatusSchema })),
  lastCheckedAt: z.number().nullable(),
  error: z.string().nullable(),
  applying: z.array(z.string()),
  autoApplyHistory: z.array(z.object({
    id: z.string(),
    kind: packageKindSchema,
    name: z.string(),
    appliedAt: z.number(),
    ok: z.boolean(),
    fromRevision: z.string().nullable(),
    toRevision: z.string().nullable(),
    error: z.string().nullable(),
  })),
})

export const packageApplyResultsSchema = z.array(z.object({
  id: z.string(),
  ok: z.boolean(),
  fromRevision: z.string().nullable(),
  toRevision: z.string().nullable(),
  command: z.array(z.string()),
  stdout: z.string(),
  stderr: z.string(),
  error: z.string().nullable(),
}))

assertParity<z.output<typeof skillSearchSnapshotSchema>, SkillSearchSnapshot>()
assertParity<z.output<typeof skillInstallResultSchema>, SkillInstallResult>()
assertParity<z.output<typeof skillUninstallResultSchema>, SkillUninstallResult>()
assertParity<z.output<typeof installedSkillsSnapshotSchema>, InstalledSkillsSnapshot>()
assertParity<z.output<typeof packageInventorySnapshotSchema>, PackageInventorySnapshot>()
assertParity<z.output<typeof packageUpdateSnapshotSchema>, PackageUpdateSnapshot>()
assertParity<z.output<typeof packageApplyResultsSchema>, PackageApplyResult[]>()
