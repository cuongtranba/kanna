import { afterEach, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileWebhookStore } from "./webhook-store.adapter"
import type { StoredWebhook } from "./webhook-registry"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-webhooks-"))
  dirs.push(dir)
  return dir
}

const HOOK: StoredWebhook = {
  id: "abcdefgh12345678",
  name: "CI",
  enabled: true,
  mode: "notify",
  chatId: "chat-1",
  template: "build {{status}}",
  createdAt: 1,
  updatedAt: 2,
  secret: "kwh_placeholder-secret-value",
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test("hooks and their secrets survive a reload", async () => {
  const dir = await tempDir()
  await createFileWebhookStore(dir).save([HOOK])
  expect(await createFileWebhookStore(dir).load()).toEqual([HOOK])
})

test("a hook's provider and model survive a reload", async () => {
  const dir = await tempDir()
  const withModel: StoredWebhook = { ...HOOK, mode: "inline", provider: "codex", model: "gpt-5.4" }
  await createFileWebhookStore(dir).save([withModel])
  expect(await createFileWebhookStore(dir).load()).toEqual([withModel])
})

test("a hook's filter, thread key, sender path and reply hint survive a reload", async () => {
  const dir = await tempDir()
  const withFilter: StoredWebhook = {
    ...HOOK,
    filter: "on: issues",
    threadKeyPath: "issue.number",
    senderPath: "sender.login",
    replyHint: "Reply with gh issue comment",
  }
  await createFileWebhookStore(dir).save([withFilter])
  expect(await createFileWebhookStore(dir).load()).toEqual([withFilter])
})

test("a missing or corrupt file loads as no hooks", async () => {
  const dir = await tempDir()
  expect(await createFileWebhookStore(dir).load()).toEqual([])
})

test("the file is owner-only after a rewrite over a looser one", async () => {
  const dir = await tempDir()
  const path = join(dir, "webhooks.json")
  await writeFile(path, "{}")
  await chmod(path, 0o644)
  await createFileWebhookStore(dir).save([HOOK])
  const mode = (await stat(path)).mode & 0o777
  expect(mode).toBe(0o600)
})
