import type { JsonValue } from "../shared/json"

export function normalizeBooleanSetting(
  name: string,
  value: JsonValue | undefined,
  fallback: boolean,
  warnings: string[],
): boolean {
  if (typeof value === "boolean") return value
  if (value !== undefined) warnings.push(`${name} must be a boolean`)
  return fallback
}
