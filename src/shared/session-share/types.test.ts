import { describe, expect, test } from "bun:test"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot } from "./types"

describe("session-share types", () => {
  test("CHAT_SNAPSHOT_VERSION is 2", () => {
    expect(CHAT_SNAPSHOT_VERSION).toBe(2)
  })

  test("ChatSnapshot is structurally typed", () => {
    const snap: ChatSnapshot = {
      version: CHAT_SNAPSHOT_VERSION,
      chatMeta: { id: "c1", title: "t", model: "m", createdAt: 0 },
      entries: [],
      datasets: {},
      attachmentsManifest: [],
    }
    expect(snap.version).toBe(2)
  })
})
