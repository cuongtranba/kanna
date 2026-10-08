import { randomBytes } from "node:crypto"
import { PAIRING_CODE_ALPHABET as ALPHABET, PAIRING_CODE_LENGTH as CODE_LENGTH } from "../shared/beacon-pair-link"

export const PAIRING_TTL_MS = 5 * 60 * 1000

export type BeaconPairingStore = {
  mint(): { code: string; expiresAt: number }
  redeem(code: string): { ok: true } | { ok: false; reason: "unknown" | "expired" }
}

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ""
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length]
  return code
}

export function createBeaconPairingStore(
  deps: { now?: () => number; generateCode?: () => string; ttlMs?: number } = {},
): BeaconPairingStore {
  const now = deps.now ?? Date.now
  const generateCode = deps.generateCode ?? randomCode
  const ttlMs = deps.ttlMs ?? PAIRING_TTL_MS
  const expiryByCode = new Map<string, number>()

  function prune(at: number): void {
    for (const [code, expiresAt] of expiryByCode) {
      if (expiresAt <= at) expiryByCode.delete(code)
    }
  }

  return {
    mint() {
      const at = now()
      prune(at)
      const code = generateCode()
      const expiresAt = at + ttlMs
      expiryByCode.set(code, expiresAt)
      return { code, expiresAt }
    },
    redeem(code) {
      const expiresAt = expiryByCode.get(code)
      if (expiresAt === undefined) return { ok: false, reason: "unknown" }
      expiryByCode.delete(code)
      return expiresAt <= now() ? { ok: false, reason: "expired" } : { ok: true }
    },
  }
}
