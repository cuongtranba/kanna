import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { isJsonObject, safeJsonParse } from "../../shared/json"
import { parseBeaconActivity, type BeaconActivity } from "../activity"
import type { DesktopPrefs } from "./desktop-types"

export const ACTIVITY_KEEP = 500

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function writePrivate(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, { mode: 0o600 })
}

export function createPrefsStore(path: string) {
  return {
    async load(): Promise<DesktopPrefs | null> {
      const text = await readText(path)
      const parsed = text === null ? null : safeJsonParse(text)
      if (parsed === null || !isJsonObject(parsed)) return null
      const { paused, launchAtLogin } = parsed
      return typeof paused === "boolean" && typeof launchAtLogin === "boolean" ? { paused, launchAtLogin } : null
    },
    async save(prefs: DesktopPrefs): Promise<void> {
      await writePrivate(path, JSON.stringify(prefs))
    },
  }
}

function parseLines(text: string): BeaconActivity[] {
  const entries: BeaconActivity[] = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue
    const parsed = safeJsonParse(line)
    const activity = parsed === null ? null : parseBeaconActivity(parsed)
    if (activity !== null) entries.push(activity)
  }
  return entries
}

export function createActivityLog(path: string, keep = ACTIVITY_KEEP) {
  let appendedSinceTrim = 0

  async function trim(): Promise<void> {
    const text = await readText(path)
    if (text === null) return
    const kept = parseLines(text).slice(-keep)
    await writePrivate(path, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
    appendedSinceTrim = 0
  }

  return {
    async load(): Promise<readonly BeaconActivity[]> {
      const text = await readText(path)
      return text === null ? [] : parseLines(text).slice(-keep)
    },
    async append(activity: BeaconActivity): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, `${JSON.stringify(activity)}\n`, { mode: 0o600 })
      appendedSinceTrim += 1
      if (appendedSinceTrim >= keep) await trim()
    },
    async clear(): Promise<void> {
      await rm(path, { force: true })
      appendedSinceTrim = 0
    },
  }
}

export const LOG_MAX_BYTES = 512 * 1024

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function createLineLog(path: string, maxBytes = LOG_MAX_BYTES): (line: string) => void {
  mkdirSync(dirname(path), { recursive: true })
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`
    if (fileSize(path) + entry.length > maxBytes) writeFileSync(path, entry, { mode: 0o600 })
    else appendFileSync(path, entry, { mode: 0o600 })
  }
}
