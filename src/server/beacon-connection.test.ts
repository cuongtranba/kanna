import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BEACON_PROTOCOL_VERSION, MIN_BEACON_PROTOCOL, type BeaconFrame } from "../shared/beacon-protocol"
import { AppSettingsManager } from "./app-settings"
import { createBeaconConnection, type BeaconConnectionSocket } from "./beacon-connection"
import { createBeaconRegistry } from "./beacon-registry"

type SendPayload = Parameters<BeaconConnectionSocket["send"]>[0]

let tempDirs: string[] = []
let managers: AppSettingsManager[] = []

afterEach(async () => {
  for (const manager of managers) manager.dispose()
  managers = []
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

function fakeSocket() {
  const frames: BeaconFrame[] = []
  const state = { closed: false }
  const socket: BeaconConnectionSocket = {
    data: { subscriptions: new Map(), snapshotSignatures: new Map(), kind: "beacon" },
    send(payload: SendPayload): number {
      frames.push(JSON.parse(String(payload)))
      return frames.length
    },
    close() {
      state.closed = true
    },
  }
  return { socket, frames, state }
}

async function createFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-beacon-conn-"))
  tempDirs.push(dir)
  const appSettings = new AppSettingsManager(path.join(dir, "settings.json"))
  managers.push(appSettings)
  await appSettings.initialize()
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const created = await appSettings.createBeaconFromPairing({
    label: "laptop",
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    os: "linux",
  })
  const registry = createBeaconRegistry()
  const connection = createBeaconConnection({ registry, appSettings })
  return { appSettings, registry, connection, beaconId: created.id, privateKey }
}

function hello(beaconId: string, protocolVersion = BEACON_PROTOCOL_VERSION): string {
  return JSON.stringify({ kind: "hello", beaconId, protocolVersion, beaconVersion: "1.2.3", os: "linux" })
}

function auth(privateKey: KeyObject, frames: BeaconFrame[]): string {
  const challenge = frames.find((frame) => frame.kind === "challenge")
  if (!challenge || challenge.kind !== "challenge") throw new Error("no challenge was sent")
  return JSON.stringify({ kind: "auth", signature: sign(null, Buffer.from(challenge.nonce), privateKey).toString("base64") })
}

describe("beacon connection", () => {
  test("a correctly signed challenge reaches ready and registers the beacon online", async () => {
    const { connection, registry, beaconId, privateKey } = await createFixture()
    const { socket, frames, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId))
    connection.handleMessage(socket, auth(privateKey, frames))
    expect(frames.map((frame) => frame.kind)).toEqual(["challenge", "ready"])
    expect(state.closed).toBe(false)
    expect(registry.isOnline(beaconId)).toBe(true)
    expect(registry.live()[0]?.beaconVersion).toBe("1.2.3")
  })

  test("a signature from the wrong key closes the socket without connecting", async () => {
    const { connection, registry, beaconId } = await createFixture()
    const intruder = generateKeyPairSync("ed25519").privateKey
    const { socket, frames, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId))
    connection.handleMessage(socket, auth(intruder, frames))
    expect(state.closed).toBe(true)
    expect(registry.isOnline(beaconId)).toBe(false)
    expect(frames.map((frame) => frame.kind)).toEqual(["challenge"])
  })

  test("an unknown beacon id is closed before any challenge is sent", async () => {
    const { connection } = await createFixture()
    const { socket, frames, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello("not-a-beacon"))
    expect(state.closed).toBe(true)
    expect(frames).toEqual([])
  })

  test("a disabled beacon is closed before any challenge is sent", async () => {
    const { connection, appSettings, beaconId } = await createFixture()
    await appSettings.writePatch({ customBeacons: { setEnabled: { id: beaconId, enabled: false } } })
    const { socket, frames, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId))
    expect(state.closed).toBe(true)
    expect(frames).toEqual([])
  })

  test("an unsupported protocol version is told the minimum then closed", async () => {
    const { connection, beaconId } = await createFixture()
    const { socket, frames, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId, BEACON_PROTOCOL_VERSION + 1))
    expect(frames).toEqual([{ kind: "incompatible", minSupported: MIN_BEACON_PROTOCOL }])
    expect(state.closed).toBe(true)
  })

  test("a ping in the ready state is answered with a pong", async () => {
    const { connection, beaconId, privateKey } = await createFixture()
    const { socket, frames } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId))
    connection.handleMessage(socket, auth(privateKey, frames))
    connection.handleMessage(socket, JSON.stringify({ kind: "ping" }))
    expect(frames.at(-1)).toEqual({ kind: "pong" })
  })

  test("closing a ready socket marks the beacon offline", async () => {
    const { connection, registry, beaconId, privateKey } = await createFixture()
    const { socket, frames } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, hello(beaconId))
    connection.handleMessage(socket, auth(privateKey, frames))
    connection.handleClose(socket)
    expect(registry.isOnline(beaconId)).toBe(false)
  })

  test("a frame that is not valid for the phase closes the socket", async () => {
    const { connection } = await createFixture()
    const { socket, state } = fakeSocket()
    connection.handleOpen(socket)
    connection.handleMessage(socket, JSON.stringify({ kind: "ping" }))
    expect(state.closed).toBe(true)
    const second = fakeSocket()
    connection.handleOpen(second.socket)
    connection.handleMessage(second.socket, "not json")
    expect(second.state.closed).toBe(true)
  })
})
