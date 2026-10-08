import { isJsonObject, safeJsonParse } from "../shared/json"
import type { BeaconPairClient, BeaconPairingResult } from "./ports"

function describeFailure(status: number, body: string): string {
  const parsed = safeJsonParse(body)
  if (parsed !== null && isJsonObject(parsed) && typeof parsed.error === "string") return parsed.error
  return body.trim() === "" ? `HTTP ${status}` : body.trim()
}

export function createPairClient(): BeaconPairClient {
  return {
    async pair(kannaUrl, request): Promise<BeaconPairingResult> {
      try {
        const response = await fetch(`${kannaUrl}/beacon/pair`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        })
        const text = await response.text()
        const parsed = safeJsonParse(text)
        if (response.ok && parsed !== null && isJsonObject(parsed) && typeof parsed.beaconId === "string") {
          return { ok: true, beaconId: parsed.beaconId }
        }
        return { ok: false, error: describeFailure(response.status, text) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
