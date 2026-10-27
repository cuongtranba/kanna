import { afterEach, expect, test } from "vite-plus/test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileSlackThreadStore } from "./slack-thread-store.adapter"
import type { SlackThreadBinding } from "./slack-threads"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-slack-threads-"))
  dirs.push(dir)
  return dir
}

const BINDING: SlackThreadBinding = {
  key: "hook:T1:C1:1.0",
  hookId: "hook",
  teamId: "T1",
  channel: "C1",
  threadTs: "1.0",
  chatId: "chat-1",
  lastSeenTs: "1.5",
  mentionTs: "1.2",
  repliedScheduleId: "slack-hook-Ev1",
  updatedAt: 9,
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test("thread bindings survive a reload and the file is private to the owner", async () => {
  const dir = await tempDir()
  await createFileSlackThreadStore(dir).save([BINDING])
  expect(await createFileSlackThreadStore(dir).load()).toEqual([BINDING])
  expect((await stat(join(dir, "slack-threads.json"))).mode & 0o777).toBe(0o600)
})

test("a missing or corrupt file loads as no bindings", async () => {
  const dir = await tempDir()
  expect(await createFileSlackThreadStore(dir).load()).toEqual([])
  await writeFile(join(dir, "slack-threads.json"), "{not json")
  expect(await createFileSlackThreadStore(dir).load()).toEqual([])
  await writeFile(join(dir, "slack-threads.json"), JSON.stringify({ threads: [BINDING, { key: "broken" }] }))
  expect(await createFileSlackThreadStore(dir).load()).toEqual([BINDING])
})
