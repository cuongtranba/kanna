/**
 * vapid-subject.ts
 *
 * Pure validation + resolution for the VAPID `sub` (JWT subject) claim used to
 * sign Web Push messages (RFC 8292). Push services validate this claim and
 * reject a malformed one — Apple returns `403 BadJwtToken` for a non-routable
 * subject such as `mailto:kanna@localhost`, which silently breaks delivery.
 *
 * A valid subject is either:
 *   - a `mailto:` URI whose email domain is a FQDN (has a dot, not `localhost`), or
 *   - an `https:` URL to a routable host.
 *
 * No IO — safe under the side-effect seal in `src/shared/**`.
 */

/**
 * Neutral, non-personal placeholder (RFC 2606 reserved domain). Accepted by
 * Apple/FCM as a valid contact, but signals "not configured" — users should set
 * their own contact in Settings → Push. Never a hardcoded personal address.
 */
export const DEFAULT_VAPID_SUBJECT = "mailto:kanna@example.com"

/** Returns true when `value` is a push-service-acceptable VAPID subject. */
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

/**
 * First valid subject of `configured` (user setting) → `legacy` (e.g. the
 * subject persisted in vapid.json) → the neutral default. Never returns an
 * invalid subject, so callers can pass it straight to the signer.
 */
export function resolveVapidSubject(
  configured: string | null | undefined,
  legacy?: string | null | undefined,
): string {
  if (configured && isValidVapidSubject(configured)) return configured.trim()
  if (legacy && isValidVapidSubject(legacy)) return legacy.trim()
  return DEFAULT_VAPID_SUBJECT
}
