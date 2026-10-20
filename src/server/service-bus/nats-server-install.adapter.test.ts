import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { installNatsServer, type ReleaseFetch } from "./nats-server-install.adapter"
import { installedBinaryPath, natsServerTarget } from "./nats-server-release"

const VERSION = "2.15.1"
const BINARY_BYTES = new TextEncoder().encode("#!/bin/sh\necho fake nats-server\n")
let dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

function tarEntry(path: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512)
  header.set(new TextEncoder().encode(path))
  header.set(new TextEncoder().encode(`${content.length.toString(8).padStart(11, "0")}\0`), 124)
  header[156] = 0x30
  const padded = new Uint8Array(Math.ceil(content.length / 512) * 512)
  padded.set(content)
  return Uint8Array.from([...header, ...padded])
}

function tarGz(entries: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const parts = Object.entries(entries).map(([path, content]) => tarEntry(path, content))
  return Uint8Array.from(gzipSync(Uint8Array.from([...parts.flatMap((part) => [...part]), ...new Uint8Array(1024)])))
}

function releaseFetch(archive: Uint8Array<ArrayBuffer>, sums: (digest: string, asset: string) => string, calls: string[] = []): ReleaseFetch {
  const target = natsServerTarget("darwin", "arm64", VERSION)
  if (target === null) throw new Error("target missing")
  const digest = createHash("sha256").update(archive).digest("hex")
  return async (url) => {
    calls.push(url)
    if (url.endsWith("/SHA256SUMS")) return new Response(sums(digest, target.asset))
    if (url.endsWith(target.asset)) return new Response(archive)
    return new Response("missing", { status: 404 })
  }
}

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-nats-install-"))
  dirs.push(dir)
  return dir
}

const options = { platform: "darwin", arch: "arm64", releaseBase: "https://release.test", sleep: async () => undefined }

describe("installNatsServer", () => {
  const folder = `nats-server-v${VERSION}-darwin-arm64`

  test("downloads, verifies and installs the executable binary", async () => {
    const dataDir = await tempDataDir()
    const archive = tarGz({ [`${folder}/README.md`]: new TextEncoder().encode("hi"), [`${folder}/nats-server`]: BINARY_BYTES })

    const result = await installNatsServer({ ...options, dataDir, fetch: releaseFetch(archive, (digest, asset) => `${digest}  ${asset}\n`) })

    expect(result.downloaded).toBe(true)
    expect(result.binaryPath).toBe(installedBinaryPath(dataDir, VERSION))
    expect(new Uint8Array(await readFile(result.binaryPath))).toEqual(BINARY_BYTES)
    expect((await stat(result.binaryPath)).mode & 0o111).not.toBe(0)
  })

  test("reuses an installed binary without touching the network", async () => {
    const dataDir = await tempDataDir()
    const archive = tarGz({ [`${folder}/nats-server`]: BINARY_BYTES })
    const calls: string[] = []
    const fetchFn = releaseFetch(archive, (digest, asset) => `${digest}  ${asset}\n`, calls)
    await installNatsServer({ ...options, dataDir, fetch: fetchFn })
    calls.length = 0

    const again = await installNatsServer({ ...options, dataDir, fetch: fetchFn })

    expect(again.downloaded).toBe(false)
    expect(calls).toEqual([])
  })

  test("refuses an archive whose hash is not the published one and leaves nothing behind", async () => {
    const dataDir = await tempDataDir()
    const archive = tarGz({ [`${folder}/nats-server`]: BINARY_BYTES })

    await expect(
      installNatsServer({ ...options, dataDir, fetch: releaseFetch(archive, (_digest, asset) => `${"0".repeat(64)}  ${asset}\n`) }),
    ).rejects.toThrow("checksum")

    const leftovers = await readdir(join(dataDir, "nats", "bin")).catch(() => [])
    expect(leftovers).toEqual([])
  })

  test("fails clearly on a platform without a pinned build", async () => {
    const dataDir = await tempDataDir()
    await expect(installNatsServer({ ...options, platform: "win32", arch: "x64", dataDir })).rejects.toThrow("external mode")
  })
})
