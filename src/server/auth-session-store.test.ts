import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAuthSessionStore } from "./auth-session-store"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-sessions-"))
  tempDirs.push(dir)
  return path.join(dir, "sessions.json")
}

const DAY_MS = 86_400_000

describe("auth-session-store", () => {
  test("persists only the sha256 hash of the token", async () => {
    const filePath = await makeFilePath()
    const store = await createAuthSessionStore({ filePath })
    store.create("super-secret-token", DAY_MS)
    await store.dispose()

    const text = await readFile(filePath, "utf8")
    expect(text).not.toContain("super-secret-token")
    const expectedHash = createHash("sha256").update("super-secret-token").digest("hex")
    expect(text).toContain(expectedHash)
  })

  test("hydrates persisted entries on construction", async () => {
    const filePath = await makeFilePath()
    const first = await createAuthSessionStore({ filePath })
    first.create("token-a", DAY_MS)
    await first.dispose()

    const second = await createAuthSessionStore({ filePath })
    expect(second.validate("token-a")).not.toBeNull()
    expect(second.validate("missing")).toBeNull()
    await second.dispose()
  })

  test("expired entries are dropped on validate and sweep", async () => {
    const filePath = await makeFilePath()
    let now = 1_000
    const store = await createAuthSessionStore({ filePath, now: () => now })
    store.create("token-x", 100)
    expect(store.validate("token-x")).not.toBeNull()

    now = 5_000
    expect(store.validate("token-x")).toBeNull()

    store.create("token-y", 100)
    now = 100_000
    store.sweep()
    expect(store.validate("token-y")).toBeNull()
    await store.dispose()
  })

  test("touch shifts expiresAt forward and survives reload", async () => {
    const filePath = await makeFilePath()
    let now = 1_000
    const first = await createAuthSessionStore({ filePath, now: () => now })
    first.create("token-z", DAY_MS)

    now = 1_000 + 12 * 60 * 60 * 1000
    const touched = first.touch("token-z", DAY_MS)
    expect(touched).not.toBeNull()
    expect(touched!.expiresAt).toBe(now + DAY_MS)
    await first.dispose()

    const second = await createAuthSessionStore({ filePath, now: () => now })
    const reloaded = second.validate("token-z")
    expect(reloaded).not.toBeNull()
    expect(reloaded!.expiresAt).toBe(now + DAY_MS)
    await second.dispose()
  })

  test("revoke removes entries from disk", async () => {
    const filePath = await makeFilePath()
    const store = await createAuthSessionStore({ filePath })
    store.create("token-r", DAY_MS)
    store.revoke("token-r")
    await store.dispose()

    const reloaded = await createAuthSessionStore({ filePath })
    expect(reloaded.validate("token-r")).toBeNull()
    await reloaded.dispose()
  })
})
