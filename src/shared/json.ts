
export type JsonPrimitive = string | number | boolean | null
export interface JsonObject {
  readonly [key: string]: JsonValue
}
export type JsonArray = readonly JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

export function parseJsonObject(text: string): JsonObject | null {
  const parsed = safeJsonParse(text)
  return parsed !== null && isJsonObject(parsed) ? parsed : null
}

export function safeJsonParse(text: string): JsonValue | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function stringField(source: JsonObject, key: string): string | undefined {
  const value = source[key]
  return typeof value === "string" ? value : undefined
}

export function nonEmptyStringField(source: JsonObject, key: string): string | null {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function numberField(source: JsonObject, key: string): number | undefined {
  const value = source[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function objectField(source: JsonObject, key: string): JsonObject | null {
  const value = source[key]
  return value !== undefined && isJsonObject(value) ? value : null
}

export function resolveJsonPath(body: JsonValue, path: string): JsonValue | undefined {
  if (path === "") return body
  let current: JsonValue | undefined = body
  for (const segment of path.split(".")) {
    if (current === undefined) return undefined
    if (isJsonObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined
    } else if (isJsonArray(current)) {
      current = /^\d+$/.test(segment) ? current[Number(segment)] : undefined
    } else {
      return undefined
    }
  }
  return current
}

export function jsonText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}
