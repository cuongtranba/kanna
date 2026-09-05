
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

export function safeJsonParse(text: string): JsonValue | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
