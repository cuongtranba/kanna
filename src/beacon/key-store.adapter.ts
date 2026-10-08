import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { BeaconKeyStore } from "./ports"

function loadPrivateKey(path: string): KeyObject {
  if (existsSync(path)) {
    return createPrivateKey({ key: readFileSync(path), format: "der", type: "pkcs8" })
  }
  const { privateKey } = generateKeyPairSync("ed25519")
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, privateKey.export({ format: "der", type: "pkcs8" }), { mode: 0o600 })
  return privateKey
}

export function createKeyStore(path: string): BeaconKeyStore {
  const privateKey = loadPrivateKey(path)
  const publicKey = createPublicKey(privateKey)
  const spkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64")
  return {
    publicKeySpkiBase64: () => spkiBase64,
    sign: (nonce) => sign(null, Buffer.from(nonce), privateKey).toString("base64"),
  }
}
