import { hostname, homedir, platform } from "node:os"
import { join } from "node:path"
import type { BeaconOs } from "../shared/beacon-protocol"
import { createBeaconFs } from "./fs.adapter"
import { createKeyStore } from "./key-store.adapter"
import { runBeaconCli } from "./main"
import { createPairClient } from "./pair-client.adapter"
import { createBeaconShell } from "./shell.adapter"
import { createStateStore } from "./state-store.adapter"
import { createWebSocketTransport } from "./transport.adapter"

const BEACON_VERSION = "0.1.0"

function detectOs(): BeaconOs {
  const name = platform()
  if (name === "darwin") return "darwin"
  if (name === "win32") return "windows"
  return "linux"
}

async function main(): Promise<void> {
  const home = process.env.KANNA_BEACON_HOME ?? join(homedir(), ".kanna-beacon")
  process.exitCode = await runBeaconCli(process.argv.slice(2), {
    os: detectOs(),
    hostname: hostname(),
    beaconVersion: BEACON_VERSION,
    openKeyStore: () => createKeyStore(join(home, "key.der")),
    stateStore: createStateStore(join(home, "state.json")),
    pairClient: createPairClient(),
    openTransport: (url) => createWebSocketTransport({ url }),
    createFs: createBeaconFs,
    createShell: createBeaconShell,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => process.stderr.write(`${line}\n`),
  })
}

void main()
