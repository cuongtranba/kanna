import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"

export interface TerminalPidEntry {
  terminalId: string
  pid: number
  cwd: string
  createdAt: number
}

interface RegistryFile {
  entries: TerminalPidEntry[]
}

export class TerminalPidRegistry {
  private readonly filePath: string
  private entries: TerminalPidEntry[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async register(entry: Omit<TerminalPidEntry, "createdAt">): Promise<void> {
    await this.loadIfNeeded()
    const next = this.entries.filter((existing) => existing.terminalId !== entry.terminalId)
    next.push({ ...entry, createdAt: Date.now() })
    this.entries = next
    await this.persist()
  }

  async unregister(terminalId: string): Promise<void> {
    await this.loadIfNeeded()
    this.entries = this.entries.filter((entry) => entry.terminalId !== terminalId)
    await this.persist()
  }

  async reapStale(): Promise<TerminalPidEntry[]> {
    const stored = await this.readFromDisk()
    if (stored.length === 0) {
      this.entries = []
      return []
    }
    for (const entry of stored) {
      killPgroup(entry.pid)
    }
    this.entries = []
    await this.persist()
    return stored
  }

  private async loadIfNeeded() {
    if (this.entries.length > 0) return
    this.entries = await this.readFromDisk()
  }

  private async readFromDisk(): Promise<TerminalPidEntry[]> {
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

function isValidEntry(value: JsonValue): value is JsonValue & TerminalPidEntry {
  if (!isJsonObject(value)) return false
  return (
    typeof value.terminalId === "string"
    && typeof value.pid === "number"
    && Number.isFinite(value.pid)
    && typeof value.cwd === "string"
    && typeof value.createdAt === "number"
  )
}

function killPgroup(pid: number) {
  if (process.platform === "win32") return
  if (!Number.isFinite(pid) || pid <= 0) return
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
  }
}
