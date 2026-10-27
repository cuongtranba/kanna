import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SnapshotStore } from "./snapshot-store.adapter"
import { generateShareToken } from "./token"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot } from "../../shared/session-share/types"

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kanna-share-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const sample: ChatSnapshot = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "t", model: "m", createdAt: 0 },
  entries: [],
  datasets: {},
  attachmentsManifest: [],
}

describe("SnapshotStore", () => {
  test("write then read round-trips, file mode 0600", async () => {
    const store = new SnapshotStore(dir)
    const token = generateShareToken()
    await store.writeSnapshot(token, sample)
    const got = await store.readSnapshot(token)
    expect(got).toEqual(sample)
    const mode = statSync(join(dir, `${token}.json`)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test("readSnapshot returns null when missing", async () => {
    const store = new SnapshotStore(dir)
    expect(await store.readSnapshot(generateShareToken())).toBeNull()
  })

  test("deleteSnapshot is idempotent", async () => {
    const store = new SnapshotStore(dir)
    const token = generateShareToken()
    await store.writeSnapshot(token, sample)
    await store.deleteSnapshot(token)
    await store.deleteSnapshot(token)
    expect(await store.readSnapshot(token)).toBeNull()
  })

  test("rejects tokenIds containing path separators", async () => {
    const store = new SnapshotStore(dir)
    await expect(store.writeSnapshot("../escape", sample)).rejects.toThrow()
  })

  test("rejects a tokenId the share route would never serve", async () => {
    const store = new SnapshotStore(dir)
    await expect(store.writeSnapshot("short", sample)).rejects.toThrow()
  })
})
