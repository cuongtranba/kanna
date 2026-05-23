import { homedir } from "node:os"
import path from "node:path"
import { getKeybindingsFilePath, LOG_PREFIX } from "../shared/branding"
import { DEFAULT_KEYBINDINGS, type KeybindingAction, type KeybindingsSnapshot } from "../shared/types"
import {
  ensureKeybindingsFile,
  readKeybindingsFile,
  watchKeybindingsDirectory,
  writeKeybindingsFile,
  type KeybindingsWatcher,
} from "./keybindings-store.adapter"

const KEYBINDING_ACTIONS = Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]

type KeybindingsFile = Partial<Record<KeybindingAction, unknown>>

export class KeybindingsManager {
  readonly filePath: string
  private watcher: KeybindingsWatcher | null = null
  private snapshot: KeybindingsSnapshot
  private readonly listeners = new Set<(snapshot: KeybindingsSnapshot) => void>()

  constructor(filePath = getKeybindingsFilePath(homedir())) {
    this.filePath = filePath
    this.snapshot = createDefaultSnapshot(this.filePath)
  }

  async initialize() {
    await ensureKeybindingsFile(this.filePath, `${JSON.stringify(DEFAULT_KEYBINDINGS, null, 2)}\n`)
    await this.reload()
    this.startWatching()
  }

  dispose() {
    this.watcher?.close()
    this.watcher = null
    this.listeners.clear()
  }

  getSnapshot() {
    return this.snapshot
  }

  onChange(listener: (snapshot: KeybindingsSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async reload() {
    const nextSnapshot = await readKeybindingsSnapshot(this.filePath)
    this.setSnapshot(nextSnapshot)
  }

  async write(bindings: Partial<Record<KeybindingAction, string[]>>) {
    const nextSnapshot = normalizeKeybindings(bindings, this.filePath)
    await writeKeybindingsFile(this.filePath, `${JSON.stringify(nextSnapshot.bindings, null, 2)}\n`)
    this.setSnapshot(nextSnapshot)
    return nextSnapshot
  }

  private setSnapshot(snapshot: KeybindingsSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private startWatching() {
    this.watcher?.close()
    const next = watchKeybindingsDirectory(this.filePath, () => {
      void this.reload().catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} Failed to reload keybindings:`, error)
      })
    })
    if (!next) {
      console.warn(`${LOG_PREFIX} Failed to watch keybindings file`)
    }
    this.watcher = next
  }
}

export async function readKeybindingsSnapshot(filePath: string) {
  const presence = await readKeybindingsFile(filePath)
  if (presence.text === null) {
    return createDefaultSnapshot(filePath)
  }
  if (!presence.text.trim()) {
    return createDefaultSnapshot(filePath, "Keybindings file was empty. Using defaults.")
  }
  try {
    const parsed = JSON.parse(presence.text) as KeybindingsFile
    return normalizeKeybindings(parsed, filePath)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return createDefaultSnapshot(filePath, "Keybindings file is invalid JSON. Using defaults.")
    }
    throw error
  }
}

export function normalizeKeybindings(value: KeybindingsFile | null | undefined, filePath = getKeybindingsFilePath(homedir())): KeybindingsSnapshot {
  const warnings: string[] = []
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null

  if (!source) {
    return createDefaultSnapshot(filePath, "Keybindings file must contain a JSON object. Using defaults.")
  }

  const bindings = {} as Record<KeybindingAction, string[]>
  for (const action of KEYBINDING_ACTIONS) {
    const rawValue = source[action]
    if (!Array.isArray(rawValue)) {
      bindings[action] = [...DEFAULT_KEYBINDINGS[action]]
      if (rawValue !== undefined) {
        warnings.push(`${action} must be an array of shortcut strings`)
      }
      continue
    }

    const normalized = rawValue
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .map((entry) => entry.toLowerCase())
      .filter(Boolean)

    if (normalized.length === 0) {
      bindings[action] = [...DEFAULT_KEYBINDINGS[action]]
      if (rawValue.length > 0 || source[action] !== undefined) {
        warnings.push(`${action} did not contain any valid shortcut strings`)
      }
      continue
    }

    bindings[action] = normalized
  }

  return {
    bindings,
    warning: warnings.length > 0 ? `Some keybindings were reset to defaults: ${warnings.join("; ")}` : null,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

function createDefaultSnapshot(filePath: string, warning: string | null = null): KeybindingsSnapshot {
  const bindings = Object.fromEntries(
    (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).map((action) => [
      action,
      [...DEFAULT_KEYBINDINGS[action]],
    ])
  ) as Record<KeybindingAction, string[]>
  return {
    bindings,
    warning,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

function formatDisplayPath(filePath: string) {
  const homePath = homedir()
  if (filePath === homePath) return "~"
  if (filePath.startsWith(`${homePath}${path.sep}`)) {
    return `~${filePath.slice(homePath.length)}`
  }
  return filePath
}
