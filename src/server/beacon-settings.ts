import { randomUUID } from "node:crypto"
import { validateBeaconAliasFormat } from "../shared/beacon-alias"
import type { BeaconConfig, BeaconInput, BeaconPatch } from "../shared/beacon-config"
import type { BeaconOs } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE, type BeaconScope } from "../shared/beacon-scope"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../shared/json"

export const BEACON_LABEL_MAX_LENGTH = 80

export class BeaconValidationException extends Error {
  constructor(readonly validationError: { code: string; message: string }) {
    super(validationError.message)
    this.name = "BeaconValidationException"
  }
}

export function validateBeaconLabel(
  label: string,
  others: readonly { id: string; label: string }[],
  selfId?: string,
): string | null {
  const trimmed = label.trim()
  if (trimmed.length === 0) return "Beacon label is required"
  if (trimmed.length > BEACON_LABEL_MAX_LENGTH) {
    return `Beacon label must be at most ${BEACON_LABEL_MAX_LENGTH} characters`
  }
  const taken = others.some((other) => other.id !== selfId && other.label === trimmed)
  return taken ? `Beacon label "${trimmed}" is already in use` : null
}

export function validateBeaconAlias(
  alias: string,
  others: readonly { id: string; alias?: string }[],
  selfId?: string,
): string | null {
  const formatError = validateBeaconAliasFormat(alias)
  if (formatError) return formatError
  const taken = others.some((other) => other.id !== selfId && other.alias === alias)
  return taken ? `Short name "${alias}" is already in use` : null
}

function readString(object: JsonObject, key: string): string | null {
  const value = object[key]
  return typeof value === "string" ? value : null
}

function isString(value: JsonValue): value is string {
  return typeof value === "string"
}

function readStringList(object: JsonObject, key: string, fallback: readonly string[]): readonly string[] {
  const value = object[key]
  if (!isJsonArray(value) || !value.every(isString)) return fallback
  return value
}

function readStrings(object: JsonObject, key: string): readonly string[] {
  const value = object[key]
  return isJsonArray(value) ? value.filter(isString) : []
}

function readFlag(object: JsonObject, key: string, fallback: boolean): boolean {
  const value = object[key]
  return typeof value === "boolean" ? value : fallback
}

function readPositive(object: JsonObject, key: string, fallback: number): number {
  const value = object[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function readOs(object: JsonObject): BeaconOs | null {
  const value = readString(object, "os")
  return value === "darwin" || value === "linux" || value === "windows" ? value : null
}

export function normalizeScope(raw: JsonValue | undefined): BeaconScope {
  const defaults = DEFAULT_BEACON_SCOPE
  if (raw === undefined || !isJsonObject(raw)) return defaults
  return {
    exec: readFlag(raw, "exec", defaults.exec),
    execAllowlist: readStringList(raw, "execAllowlist", defaults.execAllowlist),
    autoRunScripts: readFlag(raw, "autoRunScripts", defaults.autoRunScripts),
    trustedScriptHashes: readStrings(raw, "trustedScriptHashes"),
    readRoots: readStringList(raw, "readRoots", defaults.readRoots),
    writeRoots: readStringList(raw, "writeRoots", defaults.writeRoots),
    perCallTimeoutMs: readPositive(raw, "perCallTimeoutMs", defaults.perCallTimeoutMs),
    outputByteCap: readPositive(raw, "outputByteCap", defaults.outputByteCap),
    maxConcurrent: readPositive(raw, "maxConcurrent", defaults.maxConcurrent),
  }
}

function readAlias(
  entry: JsonObject,
  id: string,
  warnings: string[],
  takenAliases: ReadonlySet<string>,
): string | null {
  const alias = readString(entry, "alias")
  if (alias === null) return null
  const error = validateBeaconAliasFormat(alias) ?? (takenAliases.has(alias) ? "alias is already in use" : null)
  if (error) {
    warnings.push(`Beacon '${id}' alias dropped: ${error}`)
    return null
  }
  return alias
}

function normalizeBeaconEntry(
  entry: JsonValue,
  warnings: string[],
  takenAliases: ReadonlySet<string>,
): BeaconConfig | null {
  if (!isJsonObject(entry)) {
    warnings.push("customBeacons entry must be an object")
    return null
  }
  const id = readString(entry, "id")
  const label = readString(entry, "label")
  const publicKey = readString(entry, "publicKey")
  const os = readOs(entry)
  if (!id || label === null || !publicKey || os === null) {
    warnings.push("customBeacons entry is missing id, label, publicKey or os")
    return null
  }
  const createdAt = readString(entry, "createdAt") ?? new Date(0).toISOString()
  const alias = readAlias(entry, id, warnings, takenAliases)
  return {
    id,
    label,
    ...(alias === null ? {} : { alias }),
    publicKey,
    os,
    scope: normalizeScope(entry.scope),
    enabled: readFlag(entry, "enabled", true),
    createdAt,
    updatedAt: readString(entry, "updatedAt") ?? createdAt,
  }
}

export function normalizeBeacons(raw: JsonValue | undefined, warnings: string[]): BeaconConfig[] {
  if (raw === undefined) return []
  if (!isJsonArray(raw)) {
    warnings.push("customBeacons must be an array")
    return []
  }
  const out: BeaconConfig[] = []
  const seenIds = new Set<string>()
  const seenLabels = new Set<string>()
  const seenAliases = new Set<string>()
  for (const entry of raw) {
    const normalized = normalizeBeaconEntry(entry, warnings, seenAliases)
    if (!normalized) continue
    if (seenIds.has(normalized.id) || seenLabels.has(normalized.label)) {
      warnings.push(`Beacon '${normalized.id}' rejected: duplicate id or label`)
      continue
    }
    seenIds.add(normalized.id)
    seenLabels.add(normalized.label)
    if (normalized.alias !== undefined) seenAliases.add(normalized.alias)
    out.push(normalized)
  }
  return out
}

function checkedLabel(label: string, current: readonly BeaconConfig[], selfId?: string): string {
  const error = validateBeaconLabel(label, current, selfId)
  if (error) throw new BeaconValidationException({ code: "INVALID_LABEL", message: error })
  return label.trim()
}

function checkedAlias(
  alias: string | null | undefined,
  existing: BeaconConfig,
  current: readonly BeaconConfig[],
): string | undefined {
  if (alias === undefined) return existing.alias
  if (alias === null) return undefined
  const error = validateBeaconAlias(alias, current, existing.id)
  if (error) throw new BeaconValidationException({ code: "INVALID_ALIAS", message: error })
  return alias
}

export function createBeacon(input: BeaconInput, current: readonly BeaconConfig[]): BeaconConfig {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    label: checkedLabel(input.label, current),
    publicKey: input.publicKey,
    os: input.os,
    scope: DEFAULT_BEACON_SCOPE,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateBeacon(
  existing: BeaconConfig,
  patch: BeaconPatch,
  current: readonly BeaconConfig[],
): BeaconConfig {
  const label = patch.label === undefined ? existing.label : checkedLabel(patch.label, current, existing.id)
  const alias = checkedAlias(patch.alias, existing, current)
  const { alias: _previousAlias, ...withoutAlias } = existing
  return {
    ...withoutAlias,
    ...(alias === undefined ? {} : { alias }),
    label,
    scope: patch.scope ?? existing.scope,
    enabled: patch.enabled ?? existing.enabled,
    updatedAt: new Date().toISOString(),
  }
}

export function beaconNotFound(id: string): BeaconValidationException {
  return new BeaconValidationException({ code: "NOT_FOUND", message: `Beacon ${id} not found` })
}

export function applyBeaconSetters(
  current: BeaconConfig[],
  patch: {
    setEnabled?: { id: string; enabled: boolean }
    setScope?: { id: string; scope: BeaconScope }
    addTrustedScript?: { id: string; hash: string }
    removeTrustedScript?: { id: string; hash: string }
  },
): BeaconConfig[] {
  const stamp = new Date().toISOString()
  if (patch.setEnabled) {
    const { id, enabled } = patch.setEnabled
    return current.map((b) => (b.id === id ? { ...b, enabled, updatedAt: stamp } : b))
  }
  if (patch.setScope) {
    const { id, scope } = patch.setScope
    return current.map((b) => (b.id === id ? { ...b, scope, updatedAt: stamp } : b))
  }
  if (patch.addTrustedScript) {
    const { id, hash } = patch.addTrustedScript
    return current.map((b) =>
      b.id === id && !b.scope.trustedScriptHashes.includes(hash)
        ? { ...b, scope: { ...b.scope, trustedScriptHashes: [...b.scope.trustedScriptHashes, hash] }, updatedAt: stamp }
        : b,
    )
  }
  if (patch.removeTrustedScript) {
    const { id, hash } = patch.removeTrustedScript
    return current.map((b) =>
      b.id === id && b.scope.trustedScriptHashes.includes(hash)
        ? {
            ...b,
            scope: { ...b.scope, trustedScriptHashes: b.scope.trustedScriptHashes.filter((h) => h !== hash) },
            updatedAt: stamp,
          }
        : b,
    )
  }
  return current
}
