import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { beaconKeyFingerprint, beaconScriptHash, generateChallengeNonce, verifyBeaconSignature } from "./beacon-crypto"

function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return {
    publicKeyBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    signNonce: (nonce: string) => sign(null, Buffer.from(nonce), privateKey).toString("base64"),
  }
}

describe("beacon crypto", () => {
  test("a signature over the issued nonce verifies against the matching public key", () => {
    const identity = makeIdentity()
    const nonce = generateChallengeNonce()
    expect(verifyBeaconSignature(identity.publicKeyBase64, nonce, identity.signNonce(nonce))).toBe(true)
  })

  test("a signature does not verify for a different nonce or a different key", () => {
    const identity = makeIdentity()
    const other = makeIdentity()
    const nonce = generateChallengeNonce()
    const signature = identity.signNonce(nonce)
    expect(verifyBeaconSignature(identity.publicKeyBase64, generateChallengeNonce(), signature)).toBe(false)
    expect(verifyBeaconSignature(other.publicKeyBase64, nonce, signature)).toBe(false)
  })

  test("malformed key or signature input returns false instead of throwing", () => {
    const identity = makeIdentity()
    const nonce = generateChallengeNonce()
    expect(verifyBeaconSignature("not a key", nonce, identity.signNonce(nonce))).toBe(false)
    expect(verifyBeaconSignature(identity.publicKeyBase64, nonce, "%%%")).toBe(false)
    expect(verifyBeaconSignature("", "", "")).toBe(false)
  })

  test("challenge nonces are unique and base64url", () => {
    const first = generateChallengeNonce()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateChallengeNonce()).not.toBe(first)
  })

  test("the fingerprint is a stable sha256 hex of the key and differs per key", () => {
    const identity = makeIdentity()
    expect(beaconKeyFingerprint(identity.publicKeyBase64)).toMatch(/^[0-9a-f]{64}$/)
    expect(beaconKeyFingerprint(identity.publicKeyBase64)).toBe(beaconKeyFingerprint(identity.publicKeyBase64))
    expect(beaconKeyFingerprint(makeIdentity().publicKeyBase64)).not.toBe(beaconKeyFingerprint(identity.publicKeyBase64))
  })

  test("the script hash is the stable sha256 hex of the body and differs per body", () => {
    expect(beaconScriptHash("echo hi")).toBe("56a79f3b115448072387c2480044bfa2cf8f90e4f5fddd8c943b4e051b81f80b")
    expect(beaconScriptHash("echo hi")).not.toBe(beaconScriptHash("echo bye"))
  })
})
