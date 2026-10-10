import type { BeaconUpdateResult } from "../../shared/beacon-config"
import { isJsonObject, type JsonValue } from "../../shared/json"

export function parseBeaconUpdateResult(value: JsonValue): BeaconUpdateResult {
  if (!isJsonObject(value)) return { ok: false, error: "Unexpected response from the server" }
  if (value.ok === true) return { ok: true }
  return { ok: false, error: typeof value.error === "string" ? value.error : "Could not start the update" }
}
