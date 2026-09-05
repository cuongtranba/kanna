import { isJsonObject, type JsonObject, type JsonValue } from "../json"

export const KANNA_PLUGIN_MANIFEST_FILENAME = "kanna-plugin.json"

export const KANNA_PLUGIN_API_VERSION = 1

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/

export const RESERVED_PLUGIN_IDS: ReadonlySet<string> = new Set(["kanna"])

export interface KannaPluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly kannaPluginApi: number
  readonly entry: string | null
}

export type PluginManifestErrorCode =
  | "invalid_json"
  | "not_an_object"
  | "invalid_id"
  | "reserved_id"
  | "invalid_name"
  | "invalid_version"
  | "unsupported_api"
  | "invalid_entry"

export type PluginManifestResult =
  | { readonly ok: true; readonly manifest: KannaPluginManifest }
  | { readonly ok: false; readonly code: PluginManifestErrorCode; readonly message: string }

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id) && !RESERVED_PLUGIN_IDS.has(id)
}

export function resolvePluginEntry(entry: string | null): string {
  return entry ?? "index.ts"
}

function readString(source: JsonObject, key: string): string | null {
  const value = source[key]
  return typeof value === "string" ? value : null
}

function isContainedRelativePath(value: string): boolean {
  if (value.length === 0) return false
  if (value.startsWith("/")) return false
  if (/^[a-zA-Z]:/.test(value)) return false
  return !value.split(/[\\/]/).includes("..")
}

function fail(code: PluginManifestErrorCode, message: string): PluginManifestResult {
  return { ok: false, code, message }
}

function parseJsonBody(raw: string): { readonly ok: true; readonly value: JsonValue } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

export function parseKannaPluginManifest(raw: string): PluginManifestResult {
  const body = parseJsonBody(raw)
  if (!body.ok) {
    return fail("invalid_json", `${KANNA_PLUGIN_MANIFEST_FILENAME} is not valid JSON.`)
  }
  const parsed = body.value
  if (!isJsonObject(parsed) || Array.isArray(parsed)) {
    return fail("not_an_object", `${KANNA_PLUGIN_MANIFEST_FILENAME} must contain a JSON object.`)
  }

  const id = readString(parsed, "id")
  if (id === null || !PLUGIN_ID_PATTERN.test(id)) {
    return fail(
      "invalid_id",
      `Plugin "id" must match ${PLUGIN_ID_PATTERN.source} — lowercase letters, digits and hyphens, starting with a letter, 2-64 characters.`,
    )
  }
  if (RESERVED_PLUGIN_IDS.has(id)) {
    return fail("reserved_id", `Plugin "id" cannot be "${id}" — that name is reserved by Kanna.`)
  }

  const name = readString(parsed, "name")
  if (name === null || name.trim().length === 0) {
    return fail("invalid_name", 'Plugin "name" must be a non-empty string.')
  }

  const version = readString(parsed, "version")
  if (version === null || version.trim().length === 0) {
    return fail("invalid_version", 'Plugin "version" must be a non-empty string.')
  }

  if (parsed.kannaPluginApi !== KANNA_PLUGIN_API_VERSION) {
    return fail(
      "unsupported_api",
      `Plugin "kannaPluginApi" must be ${KANNA_PLUGIN_API_VERSION}; this host cannot load other versions.`,
    )
  }

  const entryValue = parsed.entry
  let entry: string | null = null
  if (entryValue !== undefined && entryValue !== null) {
    const declared = typeof entryValue === "string" ? entryValue : null
    if (declared === null || !isContainedRelativePath(declared)) {
      return fail("invalid_entry", 'Plugin "entry" must be a relative path inside the plugin directory.')
    }
    entry = declared
  }

  return { ok: true, manifest: { id, name, version, kannaPluginApi: KANNA_PLUGIN_API_VERSION, entry } }
}
