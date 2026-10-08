import { afterEach, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BeaconFrame } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import { AppSettingsManager } from "./app-settings"
import { createBeaconServices, type BeaconServices } from "./beacon-services"

let cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups = []
})

async function createFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-beacon-services-"))
  const appSettings = new AppSettingsManager(path.join(dir, "settings.json"))
  await appSettings.initialize()
  const services: BeaconServices = createBeaconServices({ appSettings })
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  cleanups.push(() => appSettings.dispose())
  cleanups.push(() => services.stop())
  const created = await appSettings.createBeaconFromPairing({
    label: "laptop",
    publicKey: generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    os: "windows",
  })
  const received: BeaconFrame[] = []
  services.registry.connect({
    beaconId: created.id,
    beaconVersion: "0.2.0",
    protocolVersion: 2,
    scope: DEFAULT_BEACON_SCOPE,
    socket: {
      send(payload) {
        received.push(JSON.parse(String(payload)))
        return 1
      },
    },
  })
  return { appSettings, beaconId: created.id, received }
}

test("a scope edited in Kanna Settings is pushed to the connected beacon", async () => {
  const { appSettings, beaconId, received } = await createFixture()
  const scope = { ...DEFAULT_BEACON_SCOPE, readRoots: ["C:\\Users\\me\\Documents"] }
  await appSettings.writePatch({ customBeacons: { setScope: { id: beaconId, scope } } })
  expect(received).toEqual([{ kind: "scope", scope }])
})

test("a settings change that leaves the beacon's scope alone pushes nothing", async () => {
  const { appSettings, received } = await createFixture()
  await appSettings.writePatch({ analyticsEnabled: false })
  expect(received).toEqual([])
})
