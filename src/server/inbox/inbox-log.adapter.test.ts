import { afterEach, beforeEach, expect, test } from "vite-plus/test"
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { InboxEvent } from "../../shared/inbox/events"
import { createFileInboxLog } from "./inbox-log.adapter"

let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kanna-inbox-log-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const archived: InboxEvent = { v: 1, ts: 1, kind: "inbox_thread_archived", threadId: "t1" }
const read: InboxEvent = { v: 1, ts: 2, kind: "inbox_thread_read", ids: ["a", "b"] }

test("events appended to the log read back in order", async () => {
  const log = createFileInboxLog(dir)
  expect(await log.readAll()).toEqual([])
  await log.append(archived)
  await log.append(read)
  expect(await log.readAll()).toEqual([archived, read])
})

test("a corrupt trailing line is skipped and the valid events survive", async () => {
  const log = createFileInboxLog(dir)
  await log.append(archived)
  await appendFile(path.join(dir, "inbox.jsonl"), '{"v":1,"ts":3,"kind":"inbox_thr', "utf8")
  expect(await log.readAll()).toEqual([archived])
})

test("rewrite replaces the whole log atomically", async () => {
  const log = createFileInboxLog(dir)
  await log.append(archived)
  await log.rewrite([read])
  expect(await log.readAll()).toEqual([read])
  expect(await readFile(path.join(dir, "inbox.jsonl"), "utf8")).toBe(`${JSON.stringify(read)}\n`)
})

test("a non-string chatId, projectId or draftReply drops only that field, not the whole line", async () => {
  const log = createFileInboxLog(dir)
  const item = {
    id: "i1",
    ts: 5,
    subject: "s",
    source: { kind: "inbox" },
    chatId: 7,
    projectId: { bad: true },
    title: "t",
    preview: "p",
    payload: null,
    attention: false,
    unread: true,
  }
  const report = { verdict: "fyi", summary: "sum", draftReply: 42, at: 6, chatId: "c1" }
  const lines = [
    { v: 1, ts: 5, kind: "inbox_activity_added", item },
    { v: 1, ts: 6, kind: "inbox_thread_reported", threadId: "t1", report },
  ]
  await appendFile(path.join(dir, "inbox.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8")
  const events = await log.readAll()
  expect(events).toHaveLength(2)
  const [added, reported] = events
  if (added.kind !== "inbox_activity_added" || reported.kind !== "inbox_thread_reported") throw new Error("unexpected kinds")
  expect(added.item.id).toBe("i1")
  expect(added.item.chatId).toBeUndefined()
  expect(added.item.projectId).toBeUndefined()
  expect(reported.report.summary).toBe("sum")
  expect(reported.report.draftReply).toBeUndefined()
})
