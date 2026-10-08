import type { BeaconMintResult } from "../../shared/beacon-config"
import { isJsonObject, type JsonValue } from "../../shared/json"

export function parseBeaconMintResult(value: JsonValue): BeaconMintResult {
  if (!isJsonObject(value)) return { ok: false, error: "Unexpected response from the server" }
  const { ok, code, expiresAt, error } = value
  if (ok === true && typeof code === "string" && typeof expiresAt === "number") {
    return { ok: true, code, expiresAt }
  }
  return { ok: false, error: typeof error === "string" ? error : "Could not create a pairing code" }
}
