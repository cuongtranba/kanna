import { describe, expect, test } from "bun:test"
import {
  ALL_LOGS,
  LOGS_CLEARED_ON_STORAGE_RESET,
  REPLAYED_LOGS,
  replaySourceOf,
  storeLayoutFor,
} from "./event-logs"

describe("event log catalogue", () => {
  const layout = storeLayoutFor("/data")

  test("keeps the on-disk file names existing data was written under", () => {
    expect(ALL_LOGS.map((name) => layout.logPath(name))).toEqual([
      "/data/projects.jsonl",
      "/data/stacks.jsonl",
      "/data/chats.jsonl",
      "/data/messages.jsonl",
      "/data/queued-messages.jsonl",
      "/data/turns.jsonl",
      "/data/schedules.jsonl",
      "/data/tool-requests.jsonl",
      "/data/chat-tasks.jsonl",
      "/data/tunnels.jsonl",
      "/data/shares.jsonl",
      "/data/push.jsonl",
    ])
    expect(layout.snapshotPath).toBe("/data/snapshot.json")
    expect(layout.sidebarOrderPath).toBe("/data/sidebar-order.json")
    expect(layout.transcriptsDir).toBe("/data/transcripts")
    expect(layout.transcriptPath("chat-1")).toBe("/data/transcripts/chat-1.jsonl")
  })

  test("replay source follows the order replay has always read the logs in", () => {
    expect(REPLAYED_LOGS.map((name) => replaySourceOf(name))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(replaySourceOf("stacks")).toBe(1)
    expect(replaySourceOf("chat-tasks")).toBe(8)
  })

  test("a storage reset empties every log except the push log", () => {
    expect(LOGS_CLEARED_ON_STORAGE_RESET).toContain("tunnels")
    expect(LOGS_CLEARED_ON_STORAGE_RESET).toContain("shares")
    expect(LOGS_CLEARED_ON_STORAGE_RESET).not.toContain("push")
    expect(LOGS_CLEARED_ON_STORAGE_RESET).toHaveLength(ALL_LOGS.length - 1)
  })
})
