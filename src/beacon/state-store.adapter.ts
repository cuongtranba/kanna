import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { isJsonObject, safeJsonParse } from "../shared/json"
import type { BeaconState, BeaconStateStore } from "./ports"

export function createStateStore(path: string): BeaconStateStore {
  return {
    async load(): Promise<BeaconState | null> {
      let text: string
      try {
        text = await readFile(path, "utf8")
      } catch {
        return null
      }
      const parsed = safeJsonParse(text)
      if (parsed === null || !isJsonObject(parsed)) return null
      const { kannaUrl, beaconId } = parsed
      return typeof kannaUrl === "string" && typeof beaconId === "string" ? { kannaUrl, beaconId } : null
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify(state), { mode: 0o600 })
    },
    async clear() {
      await rm(path, { force: true })
    },
  }
}
