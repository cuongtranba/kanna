import path from "node:path"
import type { SlashCommand } from "../shared/types"
import type { SkillRosterEntry } from "../shared/kanna-system-prompt"
import type { CatalogKind, CatalogScope, RawCatalogEntry } from "./local-catalog-io.adapter"

export interface LocalCatalogScanner {
  (args: { cwd: string; homeDir?: string }): RawCatalogEntry[]
}

export interface LocalCatalogStatMtimes {
  (paths: readonly string[]): number[]
}

export interface LocalCatalogServiceOptions {
  scan: LocalCatalogScanner
  statMtimes?: LocalCatalogStatMtimes
  cacheTtlMs?: number
  now?: () => number
  homeDir: string
}

interface CacheRow {
  entries: SlashCommand[]
  winners: Map<string, RawCatalogEntry>
  skills: SkillRosterEntry[]
  stamps: Map<string, number>
  expiresAt: number
}

export function catalogRootDirs(args: { cwd: string; homeDir: string }): string[] {
  return [
    path.join(args.cwd, ".claude", "skills"),
    path.join(args.cwd, ".claude", "commands"),
    path.join(args.cwd, ".claude", "settings.json"),
    path.join(args.cwd, ".claude", "settings.local.json"),
    path.join(args.homeDir, ".claude", "skills"),
    path.join(args.homeDir, ".claude", "commands"),
    path.join(args.homeDir, ".claude", "settings.json"),
    path.join(args.homeDir, ".claude", "plugins", "installed_plugins.json"),
  ]
}

const SCOPE_PRIORITY: Record<CatalogScope, number> = {
  project: 3,
  personal: 2,
  plugin: 1,
}

const KIND_PRIORITY: Record<CatalogKind, number> = {
  skill: 2,
  command: 1,
}

function normaliseKey(name: string): string {
  return name.toLowerCase()
}

function pickStronger(a: RawCatalogEntry, b: RawCatalogEntry): RawCatalogEntry {
  if (SCOPE_PRIORITY[a.scope] !== SCOPE_PRIORITY[b.scope]) {
    return SCOPE_PRIORITY[a.scope] > SCOPE_PRIORITY[b.scope] ? a : b
  }
  if (KIND_PRIORITY[a.kind] !== KIND_PRIORITY[b.kind]) {
    return KIND_PRIORITY[a.kind] > KIND_PRIORITY[b.kind] ? a : b
  }
  return a
}

function toSlashCommand(entry: RawCatalogEntry): SlashCommand {
  return {
    name: entry.name,
    description: entry.description,
    argumentHint: entry.argumentHint,
    kind: entry.kind,
    scope: entry.scope,
  }
}

function pickWinners(
  raw: readonly RawCatalogEntry[],
  opts: { requireUserInvocable: boolean },
): Map<string, RawCatalogEntry> {
  const winners = new Map<string, RawCatalogEntry>()
  for (const entry of raw) {
    if (opts.requireUserInvocable && !entry.userInvocable) continue
    const key = normaliseKey(entry.name)
    const existing = winners.get(key)
    winners.set(key, existing ? pickStronger(existing, entry) : entry)
  }
  return winners
}

export function reduceCatalog(raw: readonly RawCatalogEntry[]): SlashCommand[] {
  return [...pickWinners(raw, { requireUserInvocable: true }).values()]
    .map(toSlashCommand)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function reduceSkillRoster(raw: readonly RawCatalogEntry[]): SkillRosterEntry[] {
  return [...pickWinners(raw, { requireUserInvocable: false }).values()]
    .filter((entry) => entry.kind === "skill")
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
      filePath: entry.filePath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export class LocalCatalogService {
  private readonly cache = new Map<string, CacheRow>()
  private readonly scan: LocalCatalogScanner
  private readonly statMtimes: LocalCatalogStatMtimes | undefined
  private readonly ttl: number
  private readonly now: () => number
  private readonly homeDir: string

  constructor(opts: LocalCatalogServiceOptions) {
    this.scan = opts.scan
    this.statMtimes = opts.statMtimes
    this.ttl = opts.cacheTtlMs ?? 300_000
    this.now = opts.now ?? Date.now
    this.homeDir = opts.homeDir
  }

  list(cwd: string): SlashCommand[] {
    return this.row(cwd).entries
  }

  resolve(cwd: string, name: string): RawCatalogEntry | null {
    return this.row(cwd).winners.get(normaliseKey(name)) ?? null
  }

  skills(cwd: string): SkillRosterEntry[] {
    return this.row(cwd).skills
  }

  private row(cwd: string): CacheRow {
    const now = this.now()
    const cached = this.cache.get(cwd)
    if (cached && cached.expiresAt > now && this.stampsUnchanged(cached.stamps)) return cached
    const raw = this.scan({ cwd, homeDir: this.homeDir })
    const row: CacheRow = {
      entries: reduceCatalog(raw),
      winners: pickWinners(raw, { requireUserInvocable: true }),
      skills: reduceSkillRoster(raw),
      stamps: this.readStamps(cwd, raw),
      expiresAt: now + this.ttl,
    }
    this.cache.set(cwd, row)
    return row
  }

  private stampsUnchanged(stamps: Map<string, number>): boolean {
    if (!this.statMtimes || stamps.size === 0) return false
    const paths = [...stamps.keys()]
    const current = this.statMtimes(paths)
    return paths.every((p, i) => current[i] === stamps.get(p))
  }

  private readStamps(cwd: string, raw: readonly RawCatalogEntry[]): Map<string, number> {
    if (!this.statMtimes) return new Map()
    const paths = [
      ...catalogRootDirs({ cwd, homeDir: this.homeDir }),
      ...new Set(raw.map((entry) => entry.filePath)),
    ]
    const current = this.statMtimes(paths)
    return new Map(paths.map((p, i) => [p, current[i] ?? 0]))
  }

  invalidate(cwd?: string): void {
    if (cwd) {
      this.cache.delete(cwd)
    } else {
      this.cache.clear()
    }
  }
}
