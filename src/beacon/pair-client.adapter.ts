import { errorMessage } from "../shared/errors"
import { isJsonObject, safeJsonParse } from "../shared/json"
import { failureReason } from "./http"
import type { BeaconPairClient, BeaconPairingResult } from "./ports"

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
        return { ok: false, error: failureReason(text) ?? `HTTP ${response.status}`, status: response.status }
      } catch (error) {
        return { ok: false, error: errorMessage(error), status: null }
      }
    },
  }
}
