import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ChatSnapshot } from "../../shared/session-share/types"
import { isRecord } from "../../shared/errors"
import { isShareTokenId } from "./token"

function assertSafeTokenId(tokenId: string) {
  if (!isShareTokenId(tokenId)) {
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
}
