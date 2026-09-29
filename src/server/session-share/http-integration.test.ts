import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionShareService, type ShareEventSink } from "./index"
import type { ShareEvent } from "./share-projection"
import { SnapshotStore } from "./snapshot-store.adapter"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshotV2 } from "../../shared/session-share/types"
import { handleShareApiRequest } from "./http-routes"

class FakeStore implements ShareEventSink {
  events: ShareEvent[] = []
  async appendShareEvent(e: ShareEvent) { this.events.push(e) }
  getShareEvents() { return this.events.slice() }
}

const snap: ChatSnapshotV2 = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "T", model: "m", createdAt: 0 },
  entries: [
    { kind: "user_prompt", _id: "m1", createdAt: 1, content: "hi" },
    { kind: "assistant_text", _id: "m2", createdAt: 2, text: "hello" },
  ],
  datasets: {},
  attachmentsManifest: [],
}

describe("mint → GET /api/share/<token> integration", () => {
  test("full round-trip returns JSON 200 with snapshot payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-int-"))
    try {
      const store = new SnapshotStore(dir)
      const svc = new SessionShareService({
        events: new FakeStore(),
        snapshotStore: store,
        buildSnapshot: () => Promise.resolve(snap),
        getDefaultTtlHours: () => 24,
        now: () => 1_000,
        owner: () => "o",
      })
      const mint = await svc.mintToken({ chatId: "c1" }, "https://tunnel.example")
      expect(mint.ok).toBe(true)
      if (!mint.ok) throw new Error("mint failed")
      const res = await handleShareApiRequest(
        new Request(`http://x/api/share/${mint.data.summary.tokenId}`),
        svc,
      )
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: true; snapshot: ChatSnapshotV2 }
      expect(body.ok).toBe(true)
      expect(body.snapshot.chatMeta.title).toBe("T")
      expect(body.snapshot.entries).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("revoke before view yields 410", async () => {
    const dir = mkdtempSync(join(tmpdir(), "share-int-"))
    try {
      const store = new SnapshotStore(dir)
      const svc = new SessionShareService({
        events: new FakeStore(),
        snapshotStore: store,
        buildSnapshot: () => Promise.resolve(snap),
        getDefaultTtlHours: () => 24,
        now: () => 1_000,
        owner: () => "o",
      })
      const mint = await svc.mintToken({ chatId: "c1" }, "https://tunnel.example")
      if (!mint.ok) throw new Error("mint failed")
      const revoke = await svc.revokeToken({ tokenId: mint.data.summary.tokenId })
      expect(revoke.ok).toBe(true)
      const res = await handleShareApiRequest(
        new Request(`http://x/api/share/${mint.data.summary.tokenId}`),
        svc,
      )
      expect(res.status).toBe(410)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
