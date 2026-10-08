import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { verifyBeaconSignature } from "../server/beacon-crypto"
import { createKeyStore, eraseKeyStore } from "./key-store.adapter"

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-key-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("beacon key store", () => {
  test("signs a nonce the server verifies, and keeps the same identity across loads", () => {
    const path = join(dir, "nested", "key.der")
    const first = createKeyStore(path)
    const signature = first.sign("challenge-nonce")
    expect(verifyBeaconSignature(first.publicKeySpkiBase64(), "challenge-nonce", signature)).toBe(true)
    expect(verifyBeaconSignature(first.publicKeySpkiBase64(), "other-nonce", signature)).toBe(false)
    const reloaded = createKeyStore(path)
    expect(reloaded.publicKeySpkiBase64()).toBe(first.publicKeySpkiBase64())
    expect(verifyBeaconSignature(reloaded.publicKeySpkiBase64(), "challenge-nonce", signature)).toBe(true)
  })

  test("writes the private key readable by the owner only", () => {
    const path = join(dir, "key.der")
    createKeyStore(path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test("erasing the key gives the machine a new identity on the next open", () => {
    const path = join(dir, "key.der")
    const before = createKeyStore(path).publicKeySpkiBase64()
    eraseKeyStore(path)
    eraseKeyStore(path)
    expect(createKeyStore(path).publicKeySpkiBase64()).not.toBe(before)
  })
})
