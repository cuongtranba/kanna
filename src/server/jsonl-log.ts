import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import type { StorageBackend } from "./storage/backend"

export interface JsonlRecord<T> {
  value: T
  lineIndex: number
}

export interface JsonlCorruption {
  lineIndex: number
  error: string
  trailing: boolean
}

export interface JsonlRead<T> {
  records: JsonlRecord<T>[]
  corruptions: JsonlCorruption[]
}

export async function readJsonl<T>(storage: StorageBackend, filePath: string): Promise<JsonlRead<T>> {
  const read: JsonlRead<T> = { records: [], corruptions: [] }
  if (!(await storage.exists(filePath))) return read
  const text = await storage.readText(filePath)
  if (!text.trim()) return read

  const lines = text.split("\n")
  let lastNonEmpty = lines.length - 1
  while (lastNonEmpty >= 0 && !lines[lastNonEmpty].trim()) lastNonEmpty -= 1
  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim()
    if (!line) return
    try {
      const value: T = JSON.parse(line)
      read.records.push({ value, lineIndex })
    } catch (error) {
      read.corruptions.push({ lineIndex, error: String(error), trailing: lineIndex === lastNonEmpty })
    }
  })
  return read
}

export async function readJsonlSkippingCorrupt<T>(storage: StorageBackend, filePath: string): Promise<T[]> {
  const { records, corruptions } = await readJsonl<T>(storage, filePath)
  corruptions.forEach(() => {
    log.warn(`${LOG_PREFIX} Ignoring malformed line in ${path.basename(filePath)}`)
  })
  return records.map((record) => record.value)
}

export async function writeJsonl(storage: StorageBackend, filePath: string, records: readonly object[]): Promise<void> {
  await storage.writeText(filePath, records.map((record) => `${JSON.stringify(record)}\n`).join(""))
}
