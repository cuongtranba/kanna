import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOrGenerateVapidKeys } from "./vapid.adapter"
import { DEFAULT_VAPID_SUBJECT } from "../../shared/vapid-subject"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "kanna-vapid-"))
  tempDirs.push(dir)
  return dir
}

describe("loadOrGenerateVapidKeys", () => {
  test("generates a fresh keypair on first call and persists it to disk", async () => {
    const dir = await tempDir()
    const result = await loadOrGenerateVapidKeys(dir)

    expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]{60,90}$/)
    expect(result.privateKey).toMatch(/^[A-Za-z0-9_-]{40,60}$/)
    expect(result.subject).toBe(DEFAULT_VAPID_SUBJECT)

    const onDisk = JSON.parse(await readFile(join(dir, "vapid.json"), "utf8"))
    expect(onDisk.publicKey).toBe(result.publicKey)
    expect(onDisk.privateKey).toBe(result.privateKey)
  })

  test("reuses the existing keypair on subsequent calls", async () => {
    const dir = await tempDir()
    const first = await loadOrGenerateVapidKeys(dir)
    const second = await loadOrGenerateVapidKeys(dir)
    expect(second.publicKey).toBe(first.publicKey)
    expect(second.privateKey).toBe(first.privateKey)
  })

  test("regenerates the keypair when vapid.json is corrupt", async () => {
    const dir = await tempDir()
    const { writeFile } = await import("node:fs/promises")
    await writeFile(join(dir, "vapid.json"), "{ this is not json")

    const result = await loadOrGenerateVapidKeys(dir)
    expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]{60,90}$/)
    expect(result.privateKey).toMatch(/^[A-Za-z0-9_-]{40,60}$/)

    const onDisk = JSON.parse(await readFile(join(dir, "vapid.json"), "utf8"))
    expect(onDisk.publicKey).toBe(result.publicKey)
  })

  test("regenerates the keypair when vapid.json is missing required fields", async () => {
    const dir = await tempDir()
    const { writeFile } = await import("node:fs/promises")
    await writeFile(join(dir, "vapid.json"), JSON.stringify({ subject: "mailto:foo" }))

    const result = await loadOrGenerateVapidKeys(dir)
    expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]{60,90}$/)
    expect(result.privateKey).toMatch(/^[A-Za-z0-9_-]{40,60}$/)
  })

  test("self-heals an invalid stored subject, keeping the keypair", async () => {
    const dir = await tempDir()
    const { writeFile } = await import("node:fs/promises")
    const original = {
      publicKey: "BExamplePublicKey_000000000000000000000000000000000000000000000000000000000000000000",
      privateKey: "ExamplePrivateKey_00000000000000000000000",
      subject: "mailto:kanna@localhost",
    }
    await writeFile(join(dir, "vapid.json"), JSON.stringify(original))

    const result = await loadOrGenerateVapidKeys(dir)
    expect(result.publicKey).toBe(original.publicKey)
    expect(result.privateKey).toBe(original.privateKey)
    expect(result.subject).toBe(DEFAULT_VAPID_SUBJECT)

    const onDisk = JSON.parse(await readFile(join(dir, "vapid.json"), "utf8"))
    expect(onDisk.subject).toBe(DEFAULT_VAPID_SUBJECT)
    expect(onDisk.publicKey).toBe(original.publicKey)
  })

  test("preserves a valid stored subject", async () => {
    const dir = await tempDir()
    const { writeFile } = await import("node:fs/promises")
    const original = {
      publicKey: "BExamplePublicKey_000000000000000000000000000000000000000000000000000000000000000000",
      privateKey: "ExamplePrivateKey_00000000000000000000000",
      subject: "mailto:ops@team.dev",
    }
    await writeFile(join(dir, "vapid.json"), JSON.stringify(original))

    const result = await loadOrGenerateVapidKeys(dir)
    expect(result.subject).toBe("mailto:ops@team.dev")
  })

  test("persists the file with 0600 permissions", async () => {
    const dir = await tempDir()
    const { stat } = await import("node:fs/promises")
    await loadOrGenerateVapidKeys(dir)
    const mode = (await stat(join(dir, "vapid.json"))).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
