import type { BeaconOs } from "../shared/beacon-protocol"
import { createBeaconSession } from "./session"
import type {
  BeaconFsPort,
  BeaconKeyStore,
  BeaconPairClient,
  BeaconShellPort,
  BeaconState,
  BeaconStateStore,
  BeaconTransport,
} from "./ports"

export const BEACON_USAGE = "usage: kanna-beacon pair <kanna-url> <code> | kanna-beacon run"
export const MAX_BACKOFF_MS = 30_000
export const INCOMPATIBLE_EXIT_CODE = 2

export type BeaconCommand =
  | { command: "pair"; kannaUrl: string; code: string }
  | { command: "run" }
  | { command: "invalid"; reason: string }

export function parseBeaconArgs(argv: readonly string[]): BeaconCommand {
  const [command, ...rest] = argv
  if (command === "run") {
    return rest.length === 0 ? { command: "run" } : { command: "invalid", reason: "run takes no arguments" }
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

export function beaconSocketUrl(kannaUrl: string): string {
  return `${kannaUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/beacon`
}

export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1))
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
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
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

async function runBeacon(deps: BeaconCliDeps, state: BeaconState): Promise<number> {
  const url = beaconSocketUrl(state.kannaUrl)
  const keyStore = deps.openKeyStore()
  const shell = deps.createShell(deps.os)
  let readRoots: readonly string[] = []
  const fs = deps.createFs(() => readRoots)
  let failures = 0
  for (;;) {
    const transport = deps.openTransport(url)
    let incompatible = false
    const closed = new Promise<void>((resolve) => transport.onClose(resolve))
    createBeaconSession({
      beaconId: state.beaconId,
      beaconVersion: deps.beaconVersion,
      os: deps.os,
      transport,
      keyStore,
      fs,
      shell,
      onReady: (scope) => {
        readRoots = scope.readRoots
        failures = 0
        deps.log(`connected to ${state.kannaUrl}`)
      },
      onIncompatible: (frame) => {
        incompatible = true
        const download = frame.downloadUrl === undefined ? "" : ` Download the latest beacon: ${frame.downloadUrl}`
        deps.log(`this beacon is too old for the server (it needs protocol ${frame.minSupported} or newer).${download}`)
      },
    }).start()
    await closed
    if (incompatible) return INCOMPATIBLE_EXIT_CODE
    failures += 1
    const delay = backoffMs(failures)
    deps.log(`disconnected; reconnecting in ${delay} ms`)
    await deps.sleep(delay)
  }
}

export async function runBeaconCli(argv: readonly string[], deps: BeaconCliDeps): Promise<number> {
  const parsed = parseBeaconArgs(argv)
  if (parsed.command === "invalid") {
    deps.log(`${parsed.reason}\n${BEACON_USAGE}`)
    return 64
  }
  if (parsed.command === "pair") return pairMachine(deps, parsed.kannaUrl, parsed.code)
  const state = await deps.stateStore.load()
  if (state === null) {
    deps.log("this machine is not paired. Run: kanna-beacon pair <kanna-url> <code>")
    return 1
  }
  return runBeacon(deps, state)
}
