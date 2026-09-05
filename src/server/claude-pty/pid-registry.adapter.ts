import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"

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
    const next = this.entries.filter((existing) => existing.pid !== entry.pid)
    next.push({ ...entry, createdAt: Date.now() })
    this.entries = next
    await this.persist()
  }

  async unregister(pid: number): Promise<void> {
    await this.loadIfNeeded()
    this.entries = this.entries.filter((entry) => entry.pid !== pid)
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
      await killProcessTree(entry.pid)
      if (entry.runtimeDir && entry.runtimeDir.length > 0) {
        try { await rm(entry.runtimeDir, { recursive: true, force: true }) } catch {
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
    const parsed = safeJsonParse(raw)
    if (parsed === null || !isJsonObject(parsed) || !isJsonArray(parsed.entries)) return []
    return parsed.entries.filter(isValidEntry)
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

function isValidEntry(value: JsonValue): value is JsonValue & ClaudePtyEntry {
  if (!isJsonObject(value)) return false
  return (
    typeof value.chatId === "string"
    && typeof value.sessionId === "string"
    && typeof value.pid === "number"
    && Number.isFinite(value.pid)
    && typeof value.cwd === "string"
    && typeof value.runtimeDir === "string"
    && typeof value.createdAt === "number"
  )
}

export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") return
  if (!Number.isFinite(pid) || pid <= 0) return

  const targets = [pid, ...(await collectDescendants(pid))]
  for (const target of targets.reverse()) {
    try {
      process.kill(target, "SIGKILL")
    } catch {
    }
  }
}

async function collectDescendants(root: number): Promise<number[]> {
  let childrenByParent: Map<number, number[]>
  try {
    const proc = Bun.spawn(["ps", "-A", "-o", "pid=,ppid="], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    childrenByParent = parsePidPpid(text)
  } catch {
    return []
  }

  const descendants: number[] = []
  const queue = [root]
  const seen = new Set<number>([root])
  while (queue.length > 0) {
    const parent = queue.shift()
    if (parent === undefined) break
    for (const child of childrenByParent.get(parent) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      descendants.push(child)
      queue.push(child)
    }
  }
  return descendants
}

function parsePidPpid(psOutput: string): Map<number, number[]> {
  const childrenByParent = new Map<number, number[]>()
  for (const line of psOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (!match) continue
    const pid = Number.parseInt(match[1] ?? "", 10)
    const ppid = Number.parseInt(match[2] ?? "", 10)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
    const siblings = childrenByParent.get(ppid)
    if (siblings) siblings.push(pid)
    else childrenByParent.set(ppid, [pid])
  }
  return childrenByParent
}
