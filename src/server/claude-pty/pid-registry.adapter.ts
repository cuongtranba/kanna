import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

/**
 * On-disk registry of claude PTY children so a non-graceful server crash
 * does not leak orphan claude processes (Bun.Terminal allocates a PTY via
 * `setsid`, so the child lives in its own session and survives parent
 * death). On the next server boot `reapStale()` SIGKILLs each recorded
 * process group and removes its runtimeDir (mcp-config.json + settings).
 *
 * Mirrors {@link import("../terminal-pid-registry").TerminalPidRegistry}
 * but adds `runtimeDir` so we can clean up the tmp dir kanna allocated
 * for the spawn (otherwise it leaks every restart).
 */
export interface ClaudePtyEntry {
  chatId: string
  sessionId: string
  pid: number
  cwd: string
  runtimeDir: string
  createdAt: number
}

interface RegistryFile {
  entries: ClaudePtyEntry[]
}

export class ClaudePtyRegistry {
  private readonly filePath: string
  private entries: ClaudePtyEntry[] = []
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async register(entry: Omit<ClaudePtyEntry, "createdAt">): Promise<void> {
    await this.loadIfNeeded()
    const next = this.entries.filter((existing) => existing.sessionId !== entry.sessionId)
    next.push({ ...entry, createdAt: Date.now() })
    this.entries = next
    await this.persist()
  }

  async unregister(sessionId: string): Promise<void> {
    await this.loadIfNeeded()
    this.entries = this.entries.filter((entry) => entry.sessionId !== sessionId)
    await this.persist()
  }

  async reapStale(): Promise<ClaudePtyEntry[]> {
    const stored = await this.readFromDisk()
    if (stored.length === 0) {
      this.entries = []
      this.loaded = true
      return []
    }
    for (const entry of stored) {
      killPgroup(entry.pid)
      // Best-effort: remove the spawn's runtimeDir (mcp-config.json +
      // settings.local.json + any other kanna-side scratch). Children
      // wrote nothing user-facing here, but the dir leaks per restart
      // without cleanup.
      if (entry.runtimeDir && entry.runtimeDir.length > 0) {
        try { await rm(entry.runtimeDir, { recursive: true, force: true }) } catch {
          /* swallow — best-effort */
        }
      }
    }
    this.entries = []
    this.loaded = true
    await this.persist()
    return stored
  }

  private async loadIfNeeded() {
    if (this.loaded) return
    this.entries = await this.readFromDisk()
    this.loaded = true
  }

  private async readFromDisk(): Promise<ClaudePtyEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, "utf8")
    } catch {
      return []
    }
    try {
      const parsed = JSON.parse(raw) as Partial<RegistryFile>
      if (!parsed || !Array.isArray(parsed.entries)) return []
      return parsed.entries.filter(isValidEntry)
    } catch {
      return []
    }
  }

  private async persist() {
    const snapshot: RegistryFile = { entries: [...this.entries] }
    const serialized = JSON.stringify(snapshot)
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true })
        await writeFile(this.filePath, serialized, "utf8")
      })
    await this.writeQueue
  }
}

function isValidEntry(value: unknown): value is ClaudePtyEntry {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ClaudePtyEntry>
  return (
    typeof candidate.chatId === "string"
    && typeof candidate.sessionId === "string"
    && typeof candidate.pid === "number"
    && Number.isFinite(candidate.pid)
    && typeof candidate.cwd === "string"
    && typeof candidate.runtimeDir === "string"
    && typeof candidate.createdAt === "number"
  )
}

export function killPgroup(pid: number) {
  if (process.platform === "win32") return
  if (!Number.isFinite(pid) || pid <= 0) return
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    // ESRCH (already gone) and EPERM (race with kernel reap) are fine.
  }
}
