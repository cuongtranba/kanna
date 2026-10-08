import { createHash, createPublicKey, randomBytes, verify } from "node:crypto"

export function generateChallengeNonce(): string {
  return randomBytes(32).toString("base64url")
}

export function verifyBeaconSignature(publicKeySpkiBase64: string, nonce: string, signatureBase64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    })
    return verify(null, Buffer.from(nonce), key, Buffer.from(signatureBase64, "base64"))
  } catch {
    return false
  }
}

export function beaconKeyFingerprint(publicKeySpkiBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeySpkiBase64, "base64")).digest("hex")
}

export function beaconScriptHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}
