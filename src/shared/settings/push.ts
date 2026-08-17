import { DEFAULT_VAPID_SUBJECT, isValidVapidSubject } from "../vapid-subject"
import { isPlainObject } from "./plain-object"

export interface PushSettings {
  contactSubject: string
}

export const PUSH_DEFAULTS: PushSettings = {
  contactSubject: DEFAULT_VAPID_SUBJECT,
}

export function normalizePushSettings<T>(value: T, warnings: string[]): PushSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("push must be an object")
  }

  const raw = source?.contactSubject
  if (raw !== undefined && typeof raw !== "string") {
    warnings.push("push.contactSubject must be a string")
    return { contactSubject: PUSH_DEFAULTS.contactSubject }
  }

  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (trimmed && !isValidVapidSubject(trimmed)) {
    warnings.push(
      "push.contactSubject must be a mailto: address or https: URL with a routable domain",
    )
    return { contactSubject: PUSH_DEFAULTS.contactSubject }
  }

  return { contactSubject: trimmed || PUSH_DEFAULTS.contactSubject }
}
