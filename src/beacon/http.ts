import { isJsonObject, safeJsonParse } from "../shared/json"

export function beaconUserAgent(beaconVersion: string): string {
  return `kanna-beacon/${beaconVersion}`
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function failureReason(body: string): string | null {
  const parsed = safeJsonParse(body)
  const reason = parsed !== null && isJsonObject(parsed) && typeof parsed.error === "string" ? parsed.error : body.trim()
  return reason === "" ? null : reason
}
