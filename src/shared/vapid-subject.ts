
export const DEFAULT_VAPID_SUBJECT = "mailto:kanna@example.com"

export function isValidVapidSubject(value: string): boolean {
  const s = value.trim()

  if (s.startsWith("https://")) {
    try {
      const url = new URL(s)
      if (url.protocol !== "https:") return false
      const host = url.hostname.toLowerCase()
      if (host === "localhost") return false
      if (!host.includes(".")) return false
      if (host.startsWith(".") || host.endsWith(".")) return false
      return true
    } catch {
      return false
    }
  }

  if (s.startsWith("mailto:")) {
    const email = s.slice("mailto:".length)
    const match = /^[^\s@]+@([^\s@]+)$/.exec(email)
    if (!match) return false
    const domain = match[1].toLowerCase()
    if (domain === "localhost") return false
    if (!domain.includes(".")) return false
    if (domain.startsWith(".") || domain.endsWith(".")) return false
    return true
  }

  return false
}

export function resolveVapidSubject(
  configured: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (configured && isValidVapidSubject(configured)) return configured.trim()
  if (legacy && isValidVapidSubject(legacy)) return legacy.trim()
  return DEFAULT_VAPID_SUBJECT
}
