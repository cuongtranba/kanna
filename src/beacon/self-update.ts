import { BEACON_DOWNLOAD_PAGE } from "../shared/beacon-pair-link"
import { isBeaconBehind } from "../shared/beacon-status"
import type { BeaconUpdater } from "./ports"

export const DEFAULT_RELEASE_BASE = "https://github.com/cuongtranba/kanna/releases/download"
export const UPDATE_RETRY_BACKOFF_MS = 30 * 60_000
export const UPDATE_STAGING_SUFFIX = ".kanna-update"
export const UPDATE_OLD_SUFFIX = ".old"
export const SHA256SUMS_ASSET = "SHA256SUMS"

export interface BeaconReleaseTarget {
  bunTarget: string
  platform: string
  arch: string
  asset: string
}

export const BEACON_RELEASE_TARGETS: readonly BeaconReleaseTarget[] = [
  { bunTarget: "bun-darwin-arm64", platform: "darwin", arch: "arm64", asset: "kanna-beacon-darwin-arm64" },
  { bunTarget: "bun-darwin-x64", platform: "darwin", arch: "x64", asset: "kanna-beacon-darwin-x64" },
  { bunTarget: "bun-linux-x64", platform: "linux", arch: "x64", asset: "kanna-beacon-linux-x64" },
  { bunTarget: "bun-linux-arm64", platform: "linux", arch: "arm64", asset: "kanna-beacon-linux-arm64" },
  { bunTarget: "bun-windows-x64", platform: "win32", arch: "x64", asset: "kanna-beacon-windows-x64.exe" },
]

export type UpdateTrigger = "auto" | "manual"

export interface UpdateFailure {
  version: string
  at: number
}

export interface UpdateDecisionInput {
  beaconVersion: string
  serverVersion: string | null
  trigger: UpdateTrigger
  autoEnabled: boolean
  lastFailure: UpdateFailure | null
  now: number
}

export type UpdateDecision = { kind: "none" } | { kind: "current" } | { kind: "install"; version: string }

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256SUMS_LINE = /^([0-9a-fA-F]{64}) [ *](.+)$/

export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version)
}

function backingOff(input: UpdateDecisionInput, version: string): boolean {
  const failure = input.lastFailure
  return failure !== null && failure.version === version && input.now - failure.at < UPDATE_RETRY_BACKOFF_MS
}

export function decideUpdate(input: UpdateDecisionInput): UpdateDecision {
  const target = input.serverVersion
  if (target === null || !isReleaseVersion(target)) return { kind: "none" }
  const manual = input.trigger === "manual"
  if (!isBeaconBehind(input.beaconVersion, target)) return manual ? { kind: "current" } : { kind: "none" }
  if (manual) return { kind: "install", version: target }
  if (!input.autoEnabled || backingOff(input, target)) return { kind: "none" }
  return { kind: "install", version: target }
}

export function releaseAssetFor(platform: string, arch: string): string | null {
  return BEACON_RELEASE_TARGETS.find((target) => target.platform === platform && target.arch === arch)?.asset ?? null
}

export function releaseAssetUrl(base: string, version: string, asset: string): string {
  return `${base.replace(/\/+$/, "")}/v${version}/${asset}`
}

export function parseSha256Sums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = SHA256SUMS_LINE.exec(line.trimEnd())
    if (match === null) continue
    const [, hash, name] = match
    if (hash !== undefined && name !== undefined) sums.set(name, hash.toLowerCase())
  }
  return sums
}

export function isBunRuntimePath(execPath: string): boolean {
  const name = execPath.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  return name === "bun" || name === "bun.exe"
}

export const UNSUPPORTED_UPDATER: BeaconUpdater = {
  install: async () => ({
    ok: false,
    error: `this beacon cannot update itself yet; install the new version from ${BEACON_DOWNLOAD_PAGE}`,
  }),
}
