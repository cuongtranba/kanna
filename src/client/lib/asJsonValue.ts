import { isRecord } from "../../shared/errors"
import type { JsonValue } from "../../shared/json"

export function asJsonValue<T>(value: T): JsonValue {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      return Number.isFinite(value) ? value : null
  }
  if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry))
  if (isRecord(value)) {
    const encoded: Record<string, JsonValue> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) encoded[key] = asJsonValue(entry)
    }
    return encoded
  }
  return null
}
