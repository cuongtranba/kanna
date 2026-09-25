import { expect, test } from "bun:test"
import path from "node:path"
import { EventStore } from "./event-store"
import { LOG_FILES } from "./events"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"

const DATA_DIR = "/virtual-project-delete"
const PROJECT_PATH = "/tmp/secret-client-project"

async function bootStore(storage: InMemoryStorageBackend): Promise<EventStore> {
  const store = new EventStore(DATA_DIR, storage)
  await store.initialize()
  return store
}

async function persistedText(storage: InMemoryStorageBackend): Promise<string> {
  const names = [...Object.values(LOG_FILES), "snapshot.json", "tunnels.jsonl", "shares.jsonl", "push.jsonl"]
  const texts = await Promise.all(names.map(async (name) => {
    const file = path.join(DATA_DIR, name)
    return (await storage.exists(file)) ? storage.readText(file) : ""
  }))
  return texts.join("\n")
}

test("a deleted project leaves no trace in the data dir once the server restarts", async () => {
  const storage = new InMemoryStorageBackend()
  const store = await bootStore(storage)
  const project = await store.openProject(PROJECT_PATH, "Secret Client")
  await store.setProjectInstructions(project.id, "never mention the client name")
  const chat = await store.createChat(project.id)
  await store.renameChat(chat.id, "Quarterly numbers")
  await store.appendMessage(chat.id, { _id: "m1", kind: "user_prompt", createdAt: 1, content: "hello" })
  await store.appendTunnelEvent({ v: 1, kind: "tunnel_proposed", timestamp: 1, chatId: chat.id, tunnelId: "t1", port: 3000, sourcePid: null })
  await store.appendShareEvent({ v: 1, kind: "share.token_minted", tokenId: "tok", chatId: chat.id, expiresAt: 9, createdAt: 1, createdBy: "me" })
  await store.appendShareEvent({ v: 1, kind: "share.token_revoked", tokenId: "tok", revokedAt: 2 })
  await store.appendPushEvent({ kind: "project_mute_set", ts: 1, localPath: PROJECT_PATH, muted: true })
  await store.appendPushEvent({ kind: "project_mute_set", ts: 2, localPath: PROJECT_PATH, muted: false })
  await store.appendPushEvent({ kind: "project_mute_set", ts: 3, localPath: "/tmp/still-muted", muted: true })

  await store.deleteChat(chat.id)
  await store.deleteProject(project.id)
  const restarted = await bootStore(storage)
  await restarted.loadPushEvents()

  const persisted = await persistedText(storage)
  for (const secret of [PROJECT_PATH, "Secret Client", "never mention", chat.id, "Quarterly numbers"]) {
    expect(persisted).not.toContain(secret)
  }
  expect(persisted).toContain("/tmp/still-muted")
  expect(await storage.exists(path.join(DATA_DIR, "transcripts", `${chat.id}.jsonl`))).toBe(false)
  expect(restarted.listProjects()).toEqual([])
  expect((await restarted.openProject(PROJECT_PATH)).id).not.toBe(project.id)
})

test("a hidden project keeps its id and chats across log compaction", async () => {
  const storage = new InMemoryStorageBackend()
  const store = await bootStore(storage)
  const project = await store.openProject(PROJECT_PATH)
  const chat = await store.createChat(project.id)
  await store.removeProject(project.id)
  await store.snapshotAndTruncateLogs()
  const restarted = await bootStore(storage)

  const reopened = await restarted.openProject(PROJECT_PATH)

  expect(reopened.id).toBe(project.id)
  expect(restarted.listChatsByProject(project.id).map((c) => c.id)).toEqual([chat.id])
})
