import { isJsonArray, isJsonObject, type JsonValue } from "../../shared/json"

export const REDACTED = "[redacted]"

const SECRET_KEY_PATTERN = /api[-_]?key|token|secret|password|passphrase|authorization|credential|private[-_]?key/i
const OPAQUE_KEYS: ReadonlySet<string> = new Set(["env", "headers", "oauth"])

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || OPAQUE_KEYS.has(key)
}

export function redactSecrets(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(redactSecrets)
  if (!isJsonObject(value)) return value
  const redacted: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) && child !== null && child !== "" ? REDACTED : redactSecrets(child)
  }
  return redacted
}
