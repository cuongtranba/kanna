import { describe, expect, test } from "bun:test"
import { handleShareApiRequest } from "./http-routes"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot } from "../../shared/session-share/types"
import type { Result } from "./index"

const TOKEN = "a".repeat(40)

const snap: ChatSnapshot = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "t", model: "m", createdAt: 0 },
  messages: [], attachmentsManifest: [],
}

function service(impl: (tokenId: string) => Promise<Result<{ snapshot: ChatSnapshot }>>) {
  return { getShare: impl } as Parameters<typeof handleShareApiRequest>[1]
}

describe("handleShareApiRequest", () => {
  test("200 returns JSON snapshot envelope", async () => {
    const r = await handleShareApiRequest(new Request(`http://x/api/share/${TOKEN}`), service(async () => ({ ok: true, data: { snapshot: snap } })))
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toMatch(/application\/json/)
    const body = await r.json() as { ok: true; snapshot: ChatSnapshot }
    expect(body.ok).toBe(true)
    expect(body.snapshot.chatMeta.id).toBe("c1")
  })

  test("404 on not_found", async () => {
    const r = await handleShareApiRequest(new Request(`http://x/api/share/${TOKEN}`), service(async () => ({ ok: false, error: { kind: "not_found" } })))
    expect(r.status).toBe(404)
    const body = await r.json() as { ok: false; error: { kind: string } }
    expect(body.error.kind).toBe("not_found")
  })

  test("410 on revoked + expired", async () => {
    const r1 = await handleShareApiRequest(new Request(`http://x/api/share/${TOKEN}`), service(async () => ({ ok: false, error: { kind: "revoked" } })))
    const r2 = await handleShareApiRequest(new Request(`http://x/api/share/${TOKEN}`), service(async () => ({ ok: false, error: { kind: "expired", expiredAt: 1 } })))
    expect(r1.status).toBe(410)
    expect(r2.status).toBe(410)
  })

  test("500 on snapshot_read_failed", async () => {
    const r = await handleShareApiRequest(new Request(`http://x/api/share/${TOKEN}`), service(async () => ({ ok: false, error: { kind: "snapshot_read_failed", message: "boom" } })))
    expect(r.status).toBe(500)
  })

  test("404 when path doesn't match /api/share/:token", async () => {
    const r = await handleShareApiRequest(new Request("http://x/api/share/"), service(async () => ({ ok: true, data: { snapshot: snap } })))
    expect(r.status).toBe(404)
  })
})
