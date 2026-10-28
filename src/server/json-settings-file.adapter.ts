import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { isErrnoException } from "../shared/errors"
import type { JsonValue } from "../shared/json"

export interface JsonSettingsFileReader<Snapshot> {
  label: string
  defaults: (warning: string | null) => Snapshot
  normalize: (value: JsonValue) => Snapshot
}

export interface JsonSettingsFileReadOptions {
  strict?: boolean
}

async function readTextOrNull(filePath: string, strict: boolean): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (!strict && isErrnoException(error) && error.code === "ENOENT") return null
    throw error
  }
}

export async function readJsonSettingsFile<Snapshot>(
  filePath: string,
  reader: JsonSettingsFileReader<Snapshot>,
  options: JsonSettingsFileReadOptions = {},
): Promise<Snapshot> {
  const strict = options.strict === true
  const text = await readTextOrNull(filePath, strict)
  if (text === null) return reader.defaults(null)
  if (!text.trim()) return reader.defaults(`${reader.label} file was empty. Using defaults.`)
  let parsed: JsonValue
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    if (!strict && error instanceof SyntaxError) return reader.defaults(`${reader.label} file is invalid JSON. Using defaults.`)
    throw error
  }
  return reader.normalize(parsed)
}

export async function writeJsonSettingsFile(filePath: string, value: JsonValue): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}
