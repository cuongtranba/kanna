import { hostname, homedir, platform } from "node:os"
import { createBeaconFs } from "./fs.adapter"
import { beaconOsFor } from "./host-os"
import { createKeyStore } from "./key-store.adapter"
import { defaultSleep } from "./http"
import { runBeaconCli } from "./main"
import { createPairClient } from "./pair-client.adapter"
import { beaconFilePaths, beaconHome } from "./paths"
import { DEFAULT_RELEASE_BASE } from "./self-update"
import { cleanupUpdateLeftovers, createSelfUpdater } from "./self-update.adapter"
import { createBeaconShell } from "./shell.adapter"
import { createBeaconTransfer } from "./transfer.adapter"
import { createStateStore } from "./state-store.adapter"
import {
  FORWARDED_SIGNALS,
  SUPERVISED_ENV,
  afterBeaconRun,
  superviseRestarts,
  type ForwardedSignal,
  type SupervisorPort,
} from "./supervisor"
import { createWebSocketTransport } from "./transport.adapter"
import { BEACON_VERSION } from "./version"

function waitForEnter(): Promise<void> {
  process.stderr.write("\nPress Enter to close this window.\n")
  return new Promise((resolve) => {
    process.stdin.once("data", () => resolve())
  })
}

function processSupervisorPort(argv: readonly string[]): SupervisorPort {
  return {
    spawn() {
      const child = Bun.spawn([process.execPath, ...argv], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, [SUPERVISED_ENV]: "1" },
      })
      return {
        exited: child.exited,
        kill: (signal) => child.kill(signal),
      }
    },
    onSignal(listener) {
      const handlers = FORWARDED_SIGNALS.map((signal): [ForwardedSignal, () => void] => [signal, () => listener(signal)])
      for (const [signal, handler] of handlers) process.on(signal, handler)
      return () => {
        for (const [signal, handler] of handlers) process.off(signal, handler)
      }
    },
  }
}

async function main(): Promise<void> {
  const os = beaconOsFor(platform())
  const files = beaconFilePaths(os, beaconHome(os, process.env.KANNA_BEACON_HOME, homedir()))
  const argv = process.argv.slice(2)
  const execPath = process.execPath
  if (argv[0] === "run") await cleanupUpdateLeftovers(execPath)
  const exitCode = await runBeaconCli(argv, {
    os,
    hostname: hostname(),
    beaconVersion: BEACON_VERSION,
    openKeyStore: () => createKeyStore(files.keyFile),
    stateStore: createStateStore(files.stateFile),
    pairClient: createPairClient(),
    openTransport: (url) => createWebSocketTransport({ url }),
    createFs: createBeaconFs,
    createShell: createBeaconShell,
    createTransfer: createBeaconTransfer,
    updater: createSelfUpdater({
      execPath,
      platform: process.platform,
      arch: process.arch,
      beaconVersion: BEACON_VERSION,
      releaseBase: process.env.KANNA_BEACON_RELEASE_BASE || DEFAULT_RELEASE_BASE,
    }),
    autoUpdate: process.env.KANNA_BEACON_AUTO_UPDATE !== "disabled",
    sleep: defaultSleep,
    log: (line) => process.stderr.write(`${line}\n`),
    print: (line) => process.stdout.write(`${line}\n`),
  })
  const openedByDoubleClick = platform() === "win32" && argv.length === 0 && process.stdin.isTTY === true
  if (openedByDoubleClick) await waitForEnter()
  process.stdin.pause()
  const next = afterBeaconRun(exitCode, process.env[SUPERVISED_ENV] === "1")
  process.exitCode = next.kind === "exit" ? next.code : await superviseRestarts(processSupervisorPort(argv))
}

void main()
