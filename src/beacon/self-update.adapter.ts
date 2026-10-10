import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, chmod, open, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { errorMessage } from "../shared/errors"
import type { BeaconUpdateHooks, BeaconUpdater, BeaconUpdateResult } from "./ports"
import {
  DEFAULT_RELEASE_BASE,
  SHA256SUMS_ASSET,
  UPDATE_OLD_SUFFIX,
  UPDATE_STAGING_SUFFIX,
  isBunRuntimePath,
  isReleaseVersion,
  parseSha256Sums,
  releaseAssetFor,
  releaseAssetUrl,
} from "./self-update"

export const SUMS_TIMEOUT_MS = 30_000
export const ASSET_TIMEOUT_MS = 10 * 60_000
export const SMOKE_TIMEOUT_MS = 30_000
const FETCH_ATTEMPTS = 3

export interface SelfUpdaterOptions {
  execPath: string
  platform: string
  arch: string
  beaconVersion: string
  releaseBase?: string
  sleep?: (ms: number) => Promise<void>
}

class UpdateRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UpdateRefusal"
  }
}

class MissingReleaseFile extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MissingReleaseFile"
  }
}

function isLeftoverOf(name: string, binary: string): boolean {
  if (name === `${binary}${UPDATE_STAGING_SUFFIX}`) return true
  return name.startsWith(`${binary}.`) && name.endsWith(UPDATE_OLD_SUFFIX)
}

export async function cleanupUpdateLeftovers(execPath: string): Promise<void> {
  if (isBunRuntimePath(execPath)) return
  const folder = dirname(execPath)
  const binary = basename(execPath)
  const names = await readdir(folder).catch(() => [])
  for (const name of names.filter((entry) => isLeftoverOf(entry, binary))) {
    await rm(join(folder, name), { force: true }).catch(() => undefined)
  }
}

async function freeOldPath(execPath: string, now: number): Promise<string> {
  const old = `${execPath}${UPDATE_OLD_SUFFIX}`
  try {
    await rm(old, { force: true })
    return old
  } catch {
    return `${execPath}.${String(now)}${UPDATE_OLD_SUFFIX}`
  }
}

async function ensureWritableDirectory(execPath: string): Promise<void> {
  try {
    await access(dirname(execPath), constants.W_OK)
  } catch {
    throw new UpdateRefusal(`cannot replace ${execPath}: its folder is not writable by this user`)
  }
}

async function runVersionCommand(path: string): Promise<string> {
  const child = Bun.spawn([path, "version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: SMOKE_TIMEOUT_MS,
  })
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error(`the downloaded beacon failed to start (exit code ${String(code)})`)
  return output.trim()
}

async function swapInto(staged: string, execPath: string, platform: string): Promise<void> {
  if (platform !== "win32") {
    await rename(staged, execPath)
    return
  }
  const old = await freeOldPath(execPath, Date.now())
  await rename(execPath, old)
  try {
    await rename(staged, execPath)
  } catch (error) {
    await rename(old, execPath)
    throw error
  }
}

export function createSelfUpdater(options: SelfUpdaterOptions): BeaconUpdater {
  const base = options.releaseBase ?? DEFAULT_RELEASE_BASE
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const staged = `${options.execPath}${UPDATE_STAGING_SUFFIX}`

  async function fetchReleaseFile(version: string, name: string, timeoutMs: number): Promise<Response> {
    const url = releaseAssetUrl(base, version, name)
    let failure: Error | null = null
    for (let tried = 1; tried <= FETCH_ATTEMPTS; tried += 1) {
      try {
        const response = await fetch(url, {
          headers: { "user-agent": `kanna-beacon/${options.beaconVersion}` },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status === 404) throw new MissingReleaseFile(`release v${version} has no ${name} yet`)
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

  async function expectedDigest(version: string, asset: string): Promise<string> {
    const response = await fetchReleaseFile(version, SHA256SUMS_ASSET, SUMS_TIMEOUT_MS)
    const digest = parseSha256Sums(await response.text()).get(asset)
    if (digest === undefined) throw new MissingReleaseFile(`release v${version} has no ${asset} yet`)
    return digest
  }

  async function downloadTo(response: Response, path: string): Promise<string> {
    if (response.body === null) throw new Error("the release server sent no data")
    const hash = createHash("sha256")
    const file = await open(path, "w")
    try {
      const reader = response.body.getReader()
      for (;;) {
        const piece = await reader.read()
        if (piece.done) break
        hash.update(piece.value)
        const written = await file.write(piece.value, 0, piece.value.byteLength)
        if (written.bytesWritten !== piece.value.byteLength) throw new Error("short write while saving the update")
      }
    } finally {
      await file.close()
    }
    return hash.digest("hex")
  }

  async function stageAndSwap(version: string, asset: string, hooks: BeaconUpdateHooks): Promise<void> {
    hooks.onStep("checking")
    const expected = await expectedDigest(version, asset)
    hooks.onStep("downloading")
    const response = await fetchReleaseFile(version, asset, ASSET_TIMEOUT_MS)
    const actual = await downloadTo(response, staged)
    if (actual !== expected) throw new Error(`the downloaded ${asset} does not match the checksum in SHA256SUMS`)
    hooks.onStep("installing")
    if (options.platform !== "win32") await chmod(staged, 0o755)
    const reported = await runVersionCommand(staged)
    if (reported !== version) {
      throw new Error(`the downloaded beacon reports version ${reported || "(nothing)"}, expected ${version}`)
    }
    await hooks.beforeSwap()
    await swapInto(staged, options.execPath, options.platform)
  }

  async function install(version: string, hooks: BeaconUpdateHooks): Promise<BeaconUpdateResult> {
    try {
      if (!isReleaseVersion(version)) throw new UpdateRefusal(`not a release version: ${version}`)
      if (isBunRuntimePath(options.execPath)) {
        throw new UpdateRefusal("this beacon runs from source; self-update needs the released binary")
      }
      const asset = releaseAssetFor(options.platform, options.arch)
      if (asset === null) throw new UpdateRefusal(`no released beacon for ${options.platform}-${options.arch}`)
      await ensureWritableDirectory(options.execPath)
      await stageAndSwap(version, asset, hooks)
      return { ok: true }
    } catch (error) {
      if (!(error instanceof UpdateRefusal)) await rm(staged, { force: true }).catch(() => undefined)
      return { ok: false, error: errorMessage(error) }
    }
  }

  return { install }
}
