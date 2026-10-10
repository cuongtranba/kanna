import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BeaconUpdateStep } from "./ports"
import { cleanupUpdateLeftovers, createSelfUpdater } from "./self-update.adapter"

const ASSET = "kanna-beacon-linux-x64"
const OLD_BINARY = "#!/bin/sh\necho 1.0.0\n"
const isWindows = process.platform === "win32"

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function script(version: string): string {
  return `#!/bin/sh\necho ${version}\n`
}

let releaseRoot = ""
let server: ReturnType<typeof Bun.serve> | null = null
const requests: Array<{ path: string; userAgent: string | null }> = []
const workDirs: string[] = []

async function publish(version: string, files: Record<string, string>): Promise<void> {
  const folder = join(releaseRoot, `v${version}`)
  await mkdir(folder, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content)
}

async function installedBeacon(): Promise<{ dir: string; execPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-beacon-update-"))
  workDirs.push(dir)
  const execPath = join(dir, "kanna-beacon")
  await writeFile(execPath, OLD_BINARY, { mode: 0o755 })
  return { dir, execPath }
}

function updaterFor(execPath: string) {
  return createSelfUpdater({
    execPath,
    platform: "linux",
    arch: "x64",
    beaconVersion: "1.0.0",
    releaseBase: `http://127.0.0.1:${String(server?.port)}/releases/download`,
    sleep: async () => {},
  })
}

function recordingHooks() {
  const events: Array<BeaconUpdateStep | "swap"> = []
  return {
    events,
    hooks: {
      onStep: (step: BeaconUpdateStep) => void events.push(step),
      beforeSwap: async () => void events.push("swap"),
    },
  }
}

beforeAll(async () => {
  releaseRoot = await mkdtemp(join(tmpdir(), "kanna-fake-release-"))
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ path, userAgent: request.headers.get("user-agent") })
      const relative = path.replace(/^\/releases\/download\//, "")
      const file = Bun.file(join(releaseRoot, relative))
      return (await file.exists()) ? new Response(file) : new Response("Not Found", { status: 404 })
    },
  })
  await publish("9.9.9", { SHA256SUMS: `${sha256(script("9.9.9"))}  ${ASSET}\n`, [ASSET]: script("9.9.9") })
  await publish("9.9.8", { SHA256SUMS: `${"0".repeat(64)}  ${ASSET}\n`, [ASSET]: script("9.9.8") })
  await publish("9.9.7", { SHA256SUMS: `${sha256(script("9.9.7"))}  ${ASSET}\n` })
  await publish("9.9.6", { SHA256SUMS: `${sha256(script("1.2.3"))}  ${ASSET}\n`, [ASSET]: script("1.2.3") })
})

afterEach(async () => {
  for (const dir of workDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

afterAll(async () => {
  await server?.stop(true)
  await rm(releaseRoot, { recursive: true, force: true })
})

describe.skipIf(isWindows)("createSelfUpdater against a fake release", () => {
  test("a verified release replaces the binary with an executable new one", async () => {
    const { dir, execPath } = await installedBeacon()
    const { events, hooks } = recordingHooks()
    expect(await updaterFor(execPath).install("9.9.9", hooks)).toEqual({ ok: true })
    expect(await readFile(execPath, "utf8")).toBe(script("9.9.9"))
    expect((await stat(execPath)).mode & 0o111).not.toBe(0)
    expect(await readdir(dir)).toEqual(["kanna-beacon"])
    expect(events).toEqual(["checking", "downloading", "installing", "swap"])
    expect(requests.filter((entry) => entry.path.includes("/v9.9.9/")).map((entry) => entry.userAgent)).toContain(
      "kanna-beacon/1.0.0",
    )
  })

  test("a checksum mismatch leaves the binary byte-identical and nothing behind", async () => {
    const { dir, execPath } = await installedBeacon()
    const { events, hooks } = recordingHooks()
    const result = await updaterFor(execPath).install("9.9.8", hooks)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("checksum")
    expect(await readFile(execPath, "utf8")).toBe(OLD_BINARY)
    expect(await readdir(dir)).toEqual(["kanna-beacon"])
    expect(events).not.toContain("swap")
  })

  test("a release without the files yet fails clearly", async () => {
    const { execPath } = await installedBeacon()
    expect(await updaterFor(execPath).install("9.9.5", recordingHooks().hooks)).toEqual({
      ok: false,
      error: "release v9.9.5 has no SHA256SUMS yet",
    })
    expect(await updaterFor(execPath).install("9.9.7", recordingHooks().hooks)).toEqual({
      ok: false,
      error: `release v9.9.7 has no ${ASSET} yet`,
    })
    expect(await readFile(execPath, "utf8")).toBe(OLD_BINARY)
  })

  test("a binary that does not report the target version is never swapped in", async () => {
    const { dir, execPath } = await installedBeacon()
    const result = await updaterFor(execPath).install("9.9.6", recordingHooks().hooks)
    expect(result).toEqual({ ok: false, error: "the downloaded beacon reports version 1.2.3, expected 9.9.6" })
    expect(await readFile(execPath, "utf8")).toBe(OLD_BINARY)
    expect(await readdir(dir)).toEqual(["kanna-beacon"])
  })

  test("refuses to replace the bun runtime of a source checkout", async () => {
    const before = requests.length
    const result = await updaterFor("/opt/homebrew/bin/bun").install("9.9.9", recordingHooks().hooks)
    expect(result).toEqual({ ok: false, error: "this beacon runs from source; self-update needs the released binary" })
    expect(requests.length).toBe(before)
  })

  test("startup cleanup removes only update leftovers", async () => {
    const { dir, execPath } = await installedBeacon()
    for (const name of ["kanna-beacon.old", "kanna-beacon.1700000000.old", "kanna-beacon.kanna-update", "notes.old"]) {
      await writeFile(join(dir, name), "x")
    }
    await cleanupUpdateLeftovers(execPath)
    expect((await readdir(dir)).sort()).toEqual(["kanna-beacon", "notes.old"])
  })
})
