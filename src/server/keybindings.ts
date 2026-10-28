import { homedir } from "node:os"
import { getKeybindingsFilePath, LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import { isJsonObject, type JsonValue } from "../shared/json"
import { DEFAULT_KEYBINDINGS, KEYBINDING_ACTIONS, type KeybindingAction, type KeybindingsSnapshot } from "../shared/types"
import { shortenHomePath } from "../shared/home-path"
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file.adapter"
import { ensureKeybindingsFile, watchKeybindingsDirectory, type KeybindingsWatcher } from "./keybindings-store.adapter"

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
    await writeJsonSettingsFile(this.filePath, nextSnapshot.bindings)
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
      void this.reload().catch((error) => {
        log.warn(`${LOG_PREFIX} Failed to reload keybindings:`, String(error))
      })
    })
    if (!next) {
      log.warn(`${LOG_PREFIX} Failed to watch keybindings file`)
    }
    this.watcher = next
  }
}

export function readKeybindingsSnapshot(filePath: string): Promise<KeybindingsSnapshot> {
  return readJsonSettingsFile(filePath, {
    label: "Keybindings",
    defaults: (warning) => createDefaultSnapshot(filePath, warning),
    normalize: (value) => normalizeKeybindings(value, filePath),
  })
}

function buildBindings(pick: (action: KeybindingAction) => string[]): Record<KeybindingAction, string[]> {
  const bindings: Record<KeybindingAction, string[]> = { ...DEFAULT_KEYBINDINGS }
  for (const action of KEYBINDING_ACTIONS) {
    bindings[action] = pick(action)
  }
  return bindings
}

export function normalizeKeybindings(value: JsonValue | undefined, filePath = getKeybindingsFilePath(homedir())): KeybindingsSnapshot {
  const warnings: string[] = []
  const source = value !== undefined && isJsonObject(value) ? value : null

  if (!source) {
    return createDefaultSnapshot(filePath, "Keybindings file must contain a JSON object. Using defaults.")
  }

  const bindings = buildBindings((action) => {
    const rawValue = source[action]
    if (!Array.isArray(rawValue)) {
      if (rawValue !== undefined) {
        warnings.push(`${action} must be an array of shortcut strings`)
      }
      return [...DEFAULT_KEYBINDINGS[action]]
    }

    const normalized = rawValue
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .map((entry) => entry.toLowerCase())
      .filter(Boolean)

    if (normalized.length === 0) {
      if (rawValue.length > 0 || source[action] !== undefined) {
        warnings.push(`${action} did not contain any valid shortcut strings`)
      }
      return [...DEFAULT_KEYBINDINGS[action]]
    }

    return normalized
  })
  return {
    bindings,
    warning: warnings.length > 0 ? `Some keybindings were reset to defaults: ${warnings.join("; ")}` : null,
    filePathDisplay: shortenHomePath(filePath, homedir()),
  }
}

function createDefaultSnapshot(filePath: string, warning: string | null = null): KeybindingsSnapshot {
  const bindings = buildBindings((action) => [...DEFAULT_KEYBINDINGS[action]])
  return {
    bindings,
    warning,
    filePathDisplay: shortenHomePath(filePath, homedir()),
  }
}

