import { createHmac, timingSafeEqual } from "node:crypto"

export type SlackSignatureResult = "ok" | "unauthorized"

const MAX_SKEW_SECONDS = 300
const SIGNATURE = /^v0=([0-9a-f]{64})$/i
const TIMESTAMP = /^\d{1,12}$/

export function verifySlackSignature(
  secret: string,
  headers: Headers,
  rawBody: Uint8Array,
  nowMs: number,
): SlackSignatureResult {
  const signature = SIGNATURE.exec(headers.get("x-slack-signature") ?? "")
  const timestamp = headers.get("x-slack-request-timestamp") ?? ""
  if (!signature || !TIMESTAMP.test(timestamp)) return "unauthorized"
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return "unauthorized"
  const expected = createHmac("sha256", secret).update(`v0:${timestamp}:`).update(rawBody).digest()
  return timingSafeEqual(expected, Buffer.from(signature[1], "hex")) ? "ok" : "unauthorized"
}
