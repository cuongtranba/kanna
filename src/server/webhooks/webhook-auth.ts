import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export type WebhookAuthResult = "ok" | "unauthorized"

const SIGNATURE_PREFIX = "sha256="
const HEX_DIGEST = /^[0-9a-f]{64}$/i

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "")
  return match ? match[1] : null
}

function bearerMatches(secret: string, headers: Headers): boolean {
  const presented = bearerToken(headers)
  if (presented === null) return false
  return timingSafeEqual(digest(presented), digest(secret))
}

function signatureMatches(secret: string, headers: Headers, rawBody: Uint8Array): boolean {
  const header = headers.get("x-hub-signature-256") ?? ""
  if (!header.startsWith(SIGNATURE_PREFIX)) return false
  const presented = header.slice(SIGNATURE_PREFIX.length)
  if (!HEX_DIGEST.test(presented)) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest()
  return timingSafeEqual(expected, Buffer.from(presented, "hex"))
}

export function verifyWebhookRequest(secret: string, headers: Headers, rawBody: Uint8Array): WebhookAuthResult {
  return bearerMatches(secret, headers) || signatureMatches(secret, headers, rawBody) ? "ok" : "unauthorized"
}
