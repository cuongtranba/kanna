import { isRecord } from "../errors"

export function readSettingsSection<T>(value: T, section: string, warnings: string[]) {
  const source = isRecord(value) ? value : null
  if (value !== undefined && source === null) {
    warnings.push(`${section} must be an object`)
  }

  const warn = (key: string, expectation: string): void => {
    warnings.push(`${section}.${key} must be ${expectation}`)
  }

  return {
    source,
    warn,
    boolean(key: string, fallback: boolean): boolean {
      const raw = source?.[key]
      if (raw === undefined) return fallback
      if (typeof raw === "boolean") return raw
      warn(key, "a boolean")
      return fallback
    },
    trimmedString(key: string, fallback: string): string {
      const raw = source?.[key]
      if (raw === undefined) return fallback
      if (typeof raw !== "string") {
        warn(key, "a string")
        return fallback
      }
      return raw.trim() || fallback
    },
    member<const V extends string>(key: string, values: readonly V[], fallback: V, expectation: string): V {
      const raw = source?.[key]
      if (raw === undefined) return fallback
      const match = values.find((candidate) => candidate === raw)
      if (match !== undefined) return match
      warn(key, expectation)
      return fallback
    },
  }
}
