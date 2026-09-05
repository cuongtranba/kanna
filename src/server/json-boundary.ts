
import { isRecord } from "../shared/errors"
import { isJsonArray, isJsonObject, type JsonArray, type JsonObject, type JsonValue } from "../shared/json"

const MAX_DEPTH = 64

function hasToJson<T>(value: T): value is T & { toJSON: () => JsonValue } {
  return isRecord(value) && typeof value.toJSON === "function"
}

function encodeJson<T>(value: T, depth: number): JsonValue | undefined {
  if (value === null) return null
  const kind = typeof value
  if (kind === "string" || kind === "boolean") {
    return typeof value === "string" || typeof value === "boolean" ? value : undefined
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (kind !== "object") return undefined
  if (depth >= MAX_DEPTH) return null

  if (hasToJson(value)) return encodeJson(value.toJSON(), depth + 1)

  if (Array.isArray(value)) {
    const out: JsonValue[] = []
    for (const item of value) {
      out.push(encodeJson(item, depth + 1) ?? null)
    }
    return out
  }

  if (!isRecord(value)) return undefined
  const out: { [key: string]: JsonValue } = {}
  for (const [key, item] of Object.entries(value)) {
    const encoded = encodeJson(item, depth + 1)
    if (encoded !== undefined) out[key] = encoded
  }
  return out
}

export function toJsonValue<T>(value: T): JsonValue | null {
  return encodeJson(value, 0) ?? null
}

export function toJsonObject<T>(value: T): JsonObject {
  const json = encodeJson(value, 0)
  return json !== null && json !== undefined && isJsonObject(json) ? json : {}
}

export function toJsonArray<T>(value: T): JsonArray {
  const json = encodeJson(value, 0)
  return json !== null && json !== undefined && isJsonArray(json) ? json : []
}
