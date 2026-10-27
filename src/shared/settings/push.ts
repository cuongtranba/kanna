import { DEFAULT_VAPID_SUBJECT, isValidVapidSubject } from "../vapid-subject"
import { readSettingsSection } from "./read-fields"

export interface PushSettings {
  contactSubject: string
}

export const PUSH_DEFAULTS: PushSettings = {
  contactSubject: DEFAULT_VAPID_SUBJECT,
}

export function normalizePushSettings<T>(value: T, warnings: string[]): PushSettings {
  const section = readSettingsSection(value, "push", warnings)
  const contactSubject = section.trimmedString("contactSubject", PUSH_DEFAULTS.contactSubject)
  if (!isValidVapidSubject(contactSubject)) {
    section.warn("contactSubject", "a mailto: address or https: URL with a routable domain")
    return { contactSubject: PUSH_DEFAULTS.contactSubject }
  }
  return { contactSubject }
}
