import { createHash } from "node:crypto"
import { access, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { errorMessage } from "../../shared/errors"
import { SHA256SUMS_ASSET, parseSha256Sums, releaseAssetUrl } from "../../shared/release-sums"
import {
  NATS_RELEASE_BASE,
  installedBinaryPath,
  natsServerTarget,
  unsupportedTargetMessage,
} from "./nats-server-release"
import { extractTarGzFile } from "./tar-gz"
import { NATS_SERVER_VERSION } from "../../shared/service-bus/jetstream-config"

export type ReleaseFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>

export interface InstallNatsServerOptions {
  dataDir: string
  platform: string
  arch: string
  version?: string
  releaseBase?: string
  fetch?: ReleaseFetch
  sleep?: (ms: number) => Promise<void>
}

export interface InstalledNatsServer {
  binaryPath: string
  version: string
  downloaded: boolean
}

export const SUMS_TIMEOUT_MS = 30_000
export const ARCHIVE_TIMEOUT_MS = 5 * 60_000
const FETCH_ATTEMPTS = 3
const PART_SUFFIX = ".kanna-part"
const EXECUTABLE_MODE = 0o755

class MissingReleaseFile extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MissingReleaseFile"
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetries(
  fetchFn: ReleaseFetch,
  sleep: (ms: number) => Promise<void>,
  url: string,
  name: string,
  timeoutMs: number,
): Promise<Response> {
  let failure: Error | null = null
  for (let tried = 1; tried <= FETCH_ATTEMPTS; tried += 1) {
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "kanna-nats-install" } })
      if (response.status === 404) throw new MissingReleaseFile(`${name} is not part of this nats-server release`)
      if (response.ok) return response
      failure = new Error(`downloading ${name} failed: HTTP ${String(response.status)}`)
    } catch (error) {
      if (error instanceof MissingReleaseFile) throw error
      failure = new Error(`downloading ${name} failed: ${errorMessage(error)}`)
    }
    if (tried < FETCH_ATTEMPTS) await sleep(1000 * tried)
  }
  throw failure ?? new Error(`downloading ${name} failed`)
}

export async function installNatsServer(options: InstallNatsServerOptions): Promise<InstalledNatsServer> {
  const version = options.version ?? NATS_SERVER_VERSION
  const binaryPath = installedBinaryPath(options.dataDir, version)
  if (await exists(binaryPath)) return { binaryPath, version, downloaded: false }

  const target = natsServerTarget(options.platform, options.arch, version)
  if (target === null) throw new Error(unsupportedTargetMessage(options.platform, options.arch))

  const base = options.releaseBase ?? process.env.KANNA_NATS_RELEASE_BASE ?? NATS_RELEASE_BASE
  const fetchFn = options.fetch ?? ((url, init) => fetch(url, init))
  const sleep = options.sleep ?? defaultSleep
  const part = `${binaryPath}${PART_SUFFIX}`

  try {
    const sums = await fetchWithRetries(fetchFn, sleep, releaseAssetUrl(base, version, SHA256SUMS_ASSET), SHA256SUMS_ASSET, SUMS_TIMEOUT_MS)
    const expected = parseSha256Sums(await sums.text()).get(target.asset)
    if (expected === undefined) throw new MissingReleaseFile(`nats-server v${version} has no ${target.asset}`)

    const archive = await fetchWithRetries(fetchFn, sleep, releaseAssetUrl(base, version, target.asset), target.asset, ARCHIVE_TIMEOUT_MS)
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const actual = createHash("sha256").update(bytes).digest("hex")
    if (actual !== expected) throw new Error(`the downloaded ${target.asset} does not match the checksum in ${SHA256SUMS_ASSET}`)

    const binary = extractTarGzFile(bytes, (path) => path === `${target.folder}/${target.binaryName}`)
    if (binary === null) throw new Error(`${target.asset} does not contain ${target.binaryName}`)

    await mkdir(dirname(binaryPath), { recursive: true })
    await writeFile(part, binary)
    await chmod(part, EXECUTABLE_MODE)
    await rename(part, binaryPath)
    return { binaryPath, version, downloaded: true }
  } catch (error) {
    await rm(part, { force: true }).catch(() => undefined)
    throw error
  }
}
