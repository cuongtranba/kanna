import { BEACON_DOWNLOAD_PAGE } from "../shared/beacon-pair-link"
import { BEACON_PROTOCOL_VERSION, type BeaconOs } from "../shared/beacon-protocol"
import {
  backoffMs,
  beaconSocketUrl,
  createBeaconRunner,
  MAX_BACKOFF_MS,
  type BeaconRunnerStatus,
  type BeaconTransferContext,
} from "./runner"
import type {
  BeaconFsPort,
  BeaconKeyStore,
  BeaconPairClient,
  BeaconShellPort,
  BeaconState,
  BeaconStateStore,
  BeaconTransferPort,
  BeaconTransport,
  BeaconUpdater,
} from "./ports"

import { RESTART_EXIT_CODE } from "./supervisor"

export { backoffMs, beaconSocketUrl, MAX_BACKOFF_MS, RESTART_EXIT_CODE }

export const BEACON_USAGE = "usage: kanna-beacon pair <kanna-url> <code> | kanna-beacon run | kanna-beacon version"
export const INCOMPATIBLE_EXIT_CODE = 2
export const DESKTOP_APP_HINT = `This is the command-line beacon. To pair and run it from a window instead, install Kanna Beacon: ${BEACON_DOWNLOAD_PAGE}`

export type BeaconCommand =
  | { command: "pair"; kannaUrl: string; code: string }
  | { command: "run" }
  | { command: "version" }
  | { command: "invalid"; reason: string }

export function parseBeaconArgs(argv: readonly string[]): BeaconCommand {
  const [command, ...rest] = argv
  if (command === "run") {
    return rest.length === 0 ? { command: "run" } : { command: "invalid", reason: "run takes no arguments" }
  }
  if (command === "version") {
    return rest.length === 0 ? { command: "version" } : { command: "invalid", reason: "version takes no arguments" }
  }
  if (command === "pair") {
    const [kannaUrl, code, ...extra] = rest
    if (kannaUrl === undefined || code === undefined || extra.length > 0) {
      return { command: "invalid", reason: "pair needs <kanna-url> and <code>" }
    }
    if (!/^https?:\/\/[^/\s]+/.test(kannaUrl)) {
      return { command: "invalid", reason: "kanna-url must start with http:// or https://" }
    }
    return { command: "pair", kannaUrl: kannaUrl.replace(/\/+$/, ""), code }
  }
  return { command: "invalid", reason: command === undefined ? "missing command" : `unknown command: ${command}` }
}

export interface BeaconCliDeps {
  os: BeaconOs
  hostname: string
  beaconVersion: string
  openKeyStore: () => BeaconKeyStore
  stateStore: BeaconStateStore
  pairClient: BeaconPairClient
  openTransport: (url: string) => BeaconTransport
  createFs: (getReadRoots: () => readonly string[]) => BeaconFsPort
  createShell: (os: BeaconOs) => BeaconShellPort
  createTransfer: (context: BeaconTransferContext) => BeaconTransferPort
  updater: BeaconUpdater
  autoUpdate: boolean
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
  print: (line: string) => void
}

async function pairMachine(deps: BeaconCliDeps, kannaUrl: string, code: string): Promise<number> {
  const keyStore = deps.openKeyStore()
  const result = await deps.pairClient.pair(kannaUrl, {
    code,
    publicKey: keyStore.publicKeySpkiBase64(),
    label: deps.hostname,
    os: deps.os,
  })
  if (!result.ok) {
    deps.log(`pairing failed: ${result.error}`)
    return 1
  }
  await deps.stateStore.save({ kannaUrl, beaconId: result.beaconId })
  deps.log(`paired as ${result.beaconId}. Start the beacon with: kanna-beacon run`)
  return 0
}

function describeIncompatible(status: Extract<BeaconRunnerStatus, { phase: "incompatible" }>): string {
  const download = status.downloadUrl === undefined ? "" : ` Download the latest beacon: ${status.downloadUrl}`
  const failed = status.updateError === undefined ? "" : ` Updating itself failed: ${status.updateError}.`
  if (status.minSupported > BEACON_PROTOCOL_VERSION) {
    return `this beacon is too old for the server (it needs protocol ${status.minSupported} or newer).${failed}${download}`
  }
  const server = status.serverVersion === undefined ? "the Kanna server" : `the Kanna server (${status.serverVersion})`
  return `this beacon is newer than ${server}. Update Kanna, or install a beacon that matches it.${failed}`
}

function describeUpdate(status: Extract<BeaconRunnerStatus, { phase: "updating" }>): string {
  switch (status.step) {
    case "checking":
      return `updating to ${status.version}: checking the release`
    case "downloading":
      return `updating to ${status.version}: downloading`
    case "installing":
      return `updating to ${status.version}: verifying and installing`
    case "restarting":
      return `updated to ${status.version}; restarting`
  }
}

function describeStatus(status: BeaconRunnerStatus, kannaUrl: string): string | null {
  switch (status.phase) {
    case "online":
      return `connected to ${kannaUrl}`
    case "offline": {
      const why = status.reason === "disabled" ? "Kanna has switched this beacon off; " : "disconnected; "
      return `${why}reconnecting in ${Math.max(0, status.retryAt - Date.now())} ms`
    }
    case "revoked":
      return "Kanna no longer knows this beacon. Pair it again: kanna-beacon pair <kanna-url> <code>"
    case "incompatible":
      return describeIncompatible(status)
    case "updating":
      return describeUpdate(status)
    default:
      return null
  }
}

async function runBeacon(deps: BeaconCliDeps, state: BeaconState): Promise<number> {
  const runner = createBeaconRunner({
    state,
    os: deps.os,
    beaconVersion: deps.beaconVersion,
    keyStore: deps.openKeyStore(),
    openTransport: deps.openTransport,
    createFs: deps.createFs,
    createShell: deps.createShell,
    createTransfer: deps.createTransfer,
    updater: deps.updater,
    autoUpdate: deps.autoUpdate,
    sleep: deps.sleep,
    now: Date.now,
  })
  runner.subscribe((snapshot) => {
    const line = describeStatus(snapshot.status, state.kannaUrl)
    if (line !== null) deps.log(line)
  })
  const exit = await runner.run()
  if (exit.reason === "update") return RESTART_EXIT_CODE
  if (exit.reason === "incompatible") return INCOMPATIBLE_EXIT_CODE
  return exit.reason === "revoked" ? 1 : 0
}

export async function runBeaconCli(argv: readonly string[], deps: BeaconCliDeps): Promise<number> {
  const parsed = parseBeaconArgs(argv)
  if (parsed.command === "invalid") {
    const appHint = argv.length === 0 ? `\n${DESKTOP_APP_HINT}` : ""
    deps.log(`${parsed.reason}\n${BEACON_USAGE}${appHint}`)
    return 64
  }
  if (parsed.command === "version") {
    deps.print(deps.beaconVersion)
    return 0
  }
  if (parsed.command === "pair") return pairMachine(deps, parsed.kannaUrl, parsed.code)
  const state = await deps.stateStore.load()
  if (state === null) {
    deps.log("this machine is not paired. Run: kanna-beacon pair <kanna-url> <code>")
    return 1
  }
  return runBeacon(deps, state)
}
