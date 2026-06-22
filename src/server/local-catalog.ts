import type { SlashCommand } from "../shared/types"
import type { CatalogKind, CatalogScope, RawCatalogEntry } from "./local-catalog-io.adapter"

export interface LocalCatalogScanner {
  (args: { cwd: string; homeDir?: string }): RawCatalogEntry[]
}

export interface LocalCatalogServiceOptions {
  scan: LocalCatalogScanner
  cacheTtlMs?: number
  now?: () => number
  homeDir?: string
}

interface CacheRow {
  entries: SlashCommand[]
  expiresAt: number
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

export function mergeWithCli(cli: readonly SlashCommand[], local: readonly SlashCommand[]): SlashCommand[] {
  const cliNames = new Set(cli.map((c) => normaliseKey(c.name)))
  const cliNormalised = cli.map<SlashCommand>((c) => ({
    name: c.name,
    description: c.description,
    argumentHint: c.argumentHint,
    kind: c.kind ?? "command",
    scope: c.scope ?? "builtin",
  }))
  const localFiltered = local.filter((entry) => !cliNames.has(normaliseKey(entry.name)))
  return [...cliNormalised, ...localFiltered]
}

export class LocalCatalogService {
  private readonly cache = new Map<string, CacheRow>()
  private readonly scan: LocalCatalogScanner
  private readonly ttl: number
  private readonly now: () => number
  private readonly homeDir: string | undefined

  constructor(opts: LocalCatalogServiceOptions) {
    this.scan = opts.scan
    this.ttl = opts.cacheTtlMs ?? 30_000
    this.now = opts.now ?? Date.now
    this.homeDir = opts.homeDir
  }

  list(cwd: string): SlashCommand[] {
    const key = cwd
    const cached = this.cache.get(key)
    const now = this.now()
    if (cached && cached.expiresAt > now) return cached.entries
    const raw = this.scan({ cwd, homeDir: this.homeDir })
    const entries = reduceCatalog(raw)
    this.cache.set(key, { entries, expiresAt: now + this.ttl })
    return entries
  }

  invalidate(cwd?: string): void {
    if (cwd) {
      this.cache.delete(cwd)
    } else {
      this.cache.clear()
    }
  }
}
