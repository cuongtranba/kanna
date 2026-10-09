import { describe, expect, test } from "bun:test"
import { createPrivateKey, createPublicKey, sign } from "node:crypto"
import framesFixture from "../../apps/beacon-win7/testdata/conformance/frames.json"
import pathsFixture from "../../apps/beacon-win7/testdata/conformance/paths.json"
import signatureFixture from "../../apps/beacon-win7/testdata/conformance/signature.json"
import { verifyBeaconSignature } from "../server/beacon-crypto"
import { parseBeaconFrame } from "./beacon-protocol"
import { isPathInsideRoots } from "./beacon-scope"
import { isJsonArray, isJsonObject, type JsonValue } from "./json"

function asJson(value: object | null): JsonValue {
  return JSON.parse(JSON.stringify(value))
}

function casesOf(fixture: object): readonly JsonValue[] {
  const root = asJson(fixture)
  if (!isJsonObject(root) || !isJsonArray(root.cases)) throw new Error("fixture has no cases array")
  return root.cases
}

describe("beacon conformance fixtures shared with the Windows 7 Go beacon", () => {
  const frameCases = casesOf(framesFixture)

  test("the frame fixture is not empty", () => {
    expect(frameCases.length).toBeGreaterThan(50)
  })

  for (const entry of frameCases) {
    if (!isJsonObject(entry)) throw new Error("frame case is not an object")
    const name = String(entry.name)
    test(`frame: ${name}`, () => {
      const parsed = parseBeaconFrame(entry.frame ?? null)
      if (entry.valid === true) {
        expect(parsed).not.toBeNull()
        expect(asJson(parsed)).toEqual(entry.expected ?? entry.frame ?? null)
      } else {
        expect(parsed).toBeNull()
      }
    })
  }

  for (const entry of casesOf(pathsFixture)) {
    if (!isJsonObject(entry)) throw new Error("path case is not an object")
    const { name, target, roots, inside } = entry
    test(`path: ${String(name)}`, () => {
      if (typeof target !== "string" || !isJsonArray(roots)) throw new Error("malformed path case")
      const rootList = roots.map((root) => String(root))
      expect(isPathInsideRoots(target, rootList)).toBe(inside === true)
    })
  }

  test("signature: the fixed key yields the expected public key and a signature the server accepts", () => {
    const fixture = signatureFixture
    const privateKey = createPrivateKey({
      key: Buffer.from(fixture.pkcs8Base64, "base64"),
      format: "der",
      type: "pkcs8",
    })
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64")
    expect(spki).toBe(fixture.spkiBase64)
    expect(sign(null, Buffer.from(fixture.nonce), privateKey).toString("base64")).toBe(fixture.signatureBase64)
    expect(verifyBeaconSignature(fixture.spkiBase64, fixture.nonce, fixture.signatureBase64)).toBe(true)
    expect(verifyBeaconSignature(fixture.spkiBase64, fixture.otherNonce, fixture.signatureBase64)).toBe(false)
  })
})
