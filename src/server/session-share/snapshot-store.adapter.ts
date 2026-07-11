import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ChatSnapshot } from "../../shared/session-share/types"
import { isRecord } from "../../shared/errors"

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function assertSafeTokenId(tokenId: string) {
  if (!TOKEN_PATTERN.test(tokenId)) {
    throw new Error(`unsafe share tokenId: ${tokenId}`)
  }
}

export class SnapshotStore {
  constructor(private readonly dir: string) {}

  private path(tokenId: string): string {
    assertSafeTokenId(tokenId)
    return join(this.dir, `${tokenId}.json`)
  }

  async writeSnapshot(tokenId: string, snapshot: ChatSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const body = JSON.stringify(snapshot)
    await writeFile(this.path(tokenId), body, { mode: 0o600 })
  }

  async readSnapshot(tokenId: string): Promise<ChatSnapshot | null> {
    try {
      const body = await readFile(this.path(tokenId), "utf8")
      const snap: ChatSnapshot = JSON.parse(body)
      return snap
    } catch (err) {
      if (isRecord(err) && err.code === "ENOENT") return null
      throw err
    }
  }

  async deleteSnapshot(tokenId: string): Promise<void> {
    await rm(this.path(tokenId), { force: true })
  }

  async totalBytes(): Promise<number> {
    let entries: string[]
    try {
      entries = await readdir(this.dir)
    } catch (err) {
      if (isRecord(err) && err.code === "ENOENT") return 0
      throw err
    }
    let total = 0
    for (const name of entries) {
      const s = await stat(join(this.dir, name))
      if (s.isFile()) total += s.size
    }
    return total
  }

  async measureSnapshotBytes(snapshot: ChatSnapshot): Promise<number> {
    return Buffer.byteLength(JSON.stringify(snapshot), "utf8")
  }
}
