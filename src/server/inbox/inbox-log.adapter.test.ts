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
