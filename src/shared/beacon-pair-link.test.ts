import { expect, test } from "bun:test"
import { buildBeaconPairLink, parseBeaconPairingInput } from "./beacon-pair-link"

const TARGET = { kannaUrl: "https://kanna.example.com", code: "ABCD2345" }

test("a pairing link round-trips through the parser", () => {
  const link = buildBeaconPairLink(TARGET)
  expect(link).toBe("kanna-beacon://pair?url=https%3A%2F%2Fkanna.example.com&code=ABCD2345")
  expect(parseBeaconPairingInput(link)).toEqual(TARGET)
})

test("the CLI command Kanna shows is accepted as pasted text", () => {
  expect(parseBeaconPairingInput("kanna-beacon pair https://kanna.example.com/ ABCD2345")).toEqual(TARGET)
  expect(parseBeaconPairingInput('  "C:\\Tools\\kanna-beacon.exe" pair http://192.168.1.5:5175 abcd2345\n')).toEqual({
    kannaUrl: "http://192.168.1.5:5175",
    code: "ABCD2345",
  })
})

test("a code typed with spaces or a dash is normalized", () => {
  expect(parseBeaconPairingInput("kanna-beacon://pair?url=https://kanna.example.com&code=abcd-2345")).toEqual(TARGET)
})

test("anything that is not a pairing link or command is refused", () => {
  expect(parseBeaconPairingInput("")).toBeNull()
  expect(parseBeaconPairingInput("hello there")).toBeNull()
  expect(parseBeaconPairingInput("kanna-beacon://pair?url=ftp%3A%2F%2Fx&code=ABCD2345")).toBeNull()
  expect(parseBeaconPairingInput("kanna-beacon://pair?url=https%3A%2F%2Fx.example&code=SHORT")).toBeNull()
  expect(parseBeaconPairingInput("kanna-beacon://pair?url=https%3A%2F%2Fx.example&code=ABCD1O00")).toBeNull()
  expect(parseBeaconPairingInput("kanna-beacon://unpair?url=https%3A%2F%2Fx.example&code=ABCD2345")).toBeNull()
  expect(parseBeaconPairingInput("kanna-beacon pair https://x.example")).toBeNull()
})
