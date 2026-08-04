import path from "node:path"
import type { SlashCommand } from "../shared/types"
import type { CatalogKind, CatalogScope, RawCatalogEntry } from "./local-catalog-io.adapter"

export interface LocalCatalogScanner {
  (args: { cwd: string; homeDir?: string }): RawCatalogEntry[]
}

/** Injected port: mtime in ms per path, `0` when the path cannot be stat'ed. */
export interface LocalCatalogStatMtimes {
  (paths: readonly string[]): number[]
}

export interface LocalCatalogServiceOptions {
  scan: LocalCatalogScanner
  /**
   * Freshness port. Without it the service cannot tell a stale cache row from a
   * fresh one, so it deliberately caches nothing — always correct, never stale.
   */
  statMtimes?: LocalCatalogStatMtimes
  /** Backstop ceiling for changes mtime stamps cannot see. */
  cacheTtlMs?: number
  now?: () => number
  /** Required: the personal-scope roots are derived from it, for both the scan and its stamps. */
  homeDir: string
}

interface CacheRow {
  entries: SlashCommand[]
  /** path → mtime at scan time; a single mismatch invalidates the row. */
  stamps: Map<string, number>
  expiresAt: number
}

/**
 * The directories `scanLocalCatalog` walks. Stamping these catches skills being
 * added or removed; stamping each scanned file (see `LocalCatalogService.list`)
 * catches an existing SKILL.md being edited in place, which bumps no directory.
 */
export function catalogRootDirs(args: { cwd: string; homeDir: string }): string[] {
  return [
    path.join(args.cwd, ".claude", "skills"),
    path.join(args.cwd, ".claude", "commands"),
    path.join(args.homeDir, ".claude", "skills"),
    path.join(args.homeDir, ".claude", "commands"),
    path.join(args.homeDir, ".claude", "plugins"),
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

export function reduceCatalog(raw: readonly RawCatalogEntry[]): SlashCommand[] {
  const winners = new Map<string, RawCatalogEntry>()
  for (const entry of raw) {
    if (!entry.userInvocable) continue
    const key = normaliseKey(entry.name)
    const existing = winners.get(key)
    winners.set(key, existing ? pickStronger(existing, entry) : entry)
  }
  return [...winners.values()]
    .map(toSlashCommand)
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
    const now = this.now()
    const cached = this.cache.get(cwd)
    if (cached && cached.expiresAt > now && this.stampsUnchanged(cached.stamps)) return cached.entries
    const raw = this.scan({ cwd, homeDir: this.homeDir })
    const entries = reduceCatalog(raw)
    this.cache.set(cwd, { entries, stamps: this.readStamps(cwd, raw), expiresAt: now + this.ttl })
    return entries
  }

  /** Empty stamps mean "unstampable" — the row can never be trusted again. */
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
