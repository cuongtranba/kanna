import { hostname, homedir, platform } from "node:os"
import { join } from "node:path"
import { createBeaconFs } from "./fs.adapter"
import { beaconOsFor } from "./host-os"
import { createKeyStore } from "./key-store.adapter"
import { runBeaconCli } from "./main"
import { createPairClient } from "./pair-client.adapter"
import { createBeaconShell } from "./shell.adapter"
import { createBeaconTransfer } from "./transfer.adapter"
import { createStateStore } from "./state-store.adapter"
import { createWebSocketTransport } from "./transport.adapter"
import { BEACON_VERSION } from "./version"


function waitForEnter(): Promise<void> {
  process.stderr.write("\nPress Enter to close this window.\n")
  return new Promise((resolve) => {
    process.stdin.once("data", () => resolve())
  })
}

async function main(): Promise<void> {
  const home = process.env.KANNA_BEACON_HOME ?? join(homedir(), ".kanna-beacon")
  const argv = process.argv.slice(2)
  const exitCode = await runBeaconCli(argv, {
    os: beaconOsFor(platform()),
    hostname: hostname(),
    beaconVersion: BEACON_VERSION,
    openKeyStore: () => createKeyStore(join(home, "key.der")),
    stateStore: createStateStore(join(home, "state.json")),
    pairClient: createPairClient(),
    openTransport: (url) => createWebSocketTransport({ url }),
    createFs: createBeaconFs,
    createShell: createBeaconShell,
    createTransfer: createBeaconTransfer,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => process.stderr.write(`${line}\n`),
  })
  const openedByDoubleClick = platform() === "win32" && argv.length === 0 && process.stdin.isTTY === true
  if (openedByDoubleClick) await waitForEnter()
  process.exitCode = exitCode
  process.stdin.pause()
}

void main()
