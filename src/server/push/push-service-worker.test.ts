import { readFileSync } from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { describe, expect, test } from "vite-plus/test"
import { HTTP_ROUTES } from "../../shared/http-routes"
import type { JsonValue } from "../../shared/json"

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "..", "..", "public")
const ORIGIN = "https://kanna.example"

interface Shown {
  title: string
  options: JsonValue
}

interface FetchCall {
  url: string
  init: JsonValue
}

function bootServiceWorker(fetchOutcome: "ok" | "conflict" | "offline") {
  const handlers = new Map<string, (event: object) => void>()
  const shown: Shown[] = []
  const opened: string[] = []
  const fetches: FetchCall[] = []
  const scripts = new Map([["/sw-notifications.js", readFileSync(path.join(PUBLIC_DIR, "sw-notifications.js"), "utf8")]])
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: object) => void) => { handlers.set(type, handler) },
    registration: { showNotification: async (title: string, options: JsonValue) => { shown.push({ title, options }) } },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => { opened.push(url) },
      claim: async () => {},
    },
    skipWaiting: () => {},
  }
  const context = vm.createContext({
    self,
    URL,
    fetch: async (url: string, init: JsonValue) => {
      fetches.push({ url, init })
      if (fetchOutcome === "offline") throw new Error("offline")
      return { ok: fetchOutcome === "ok", status: fetchOutcome === "ok" ? 200 : 409 }
    },
    importScripts: (script: string) => {
      const source = scripts.get(script)
      if (source === undefined) throw new Error(`unexpected importScripts(${script})`)
      vm.runInContext(source, context)
    },
  })
  vm.runInContext(readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8"), context)

  async function fire(type: string, event: object, pending: Promise<void>[]): Promise<void> {
    const handler = handlers.get(type)
    if (handler === undefined) throw new Error(`no ${type} handler`)
    handler(event)
    await Promise.all(pending)
  }

  return {
    shown,
    opened,
    fetches,
    async receive(payload: JsonValue) {
      const pending: Promise<void>[] = []
      await fire("push", { data: { json: () => payload }, waitUntil: (work: Promise<void>) => { pending.push(work) } }, pending)
    },
    async click(data: JsonValue, action: string) {
      const pending: Promise<void>[] = []
      await fire("notificationclick", {
        action,
        notification: { data, tag: "t1", close: () => {} },
        waitUntil: (work: Promise<void>) => { pending.push(work) },
      }, pending)
    },
  }
}

const PROPOSAL_PUSH: JsonValue = {
  v: 1,
  kind: "inbox_proposal",
  projectLocalPath: "",
  projectTitle: "Zalo",
  chatId: "chat-1",
  chatTitle: "An",
  chatUrl: "/inbox/t1",
  threadId: "t1",
  proposalId: "p1",
  body: "It is due on Friday.",
  actions: [{ action: "send", title: "Send" }],
  ts: 1,
}

async function shownOptions(worker: ReturnType<typeof bootServiceWorker>, payload: JsonValue) {
  await worker.receive(payload)
  const options = worker.shown[0]?.options
  if (options === undefined || options === null || typeof options !== "object" || Array.isArray(options)) throw new Error("no notification was shown")
  return options
}

describe("push notifications in the service worker", () => {
  test("an approval push shows its text and a Send action that remembers only the ids", async () => {
    const worker = bootServiceWorker("ok")

    const options = await shownOptions(worker, PROPOSAL_PUSH)

    expect(options).toMatchObject({
      body: "It is due on Friday.",
      tag: "t1",
      actions: [{ action: "send", title: "Send" }],
      data: { chatUrl: "/inbox/t1", approve: { threadId: "t1", proposalId: "p1" } },
    })
    expect(JSON.stringify(options)).not.toMatch(/token|secret|cookie/i)
  })

  test("a push without a proposal never shows a Send action, even if the payload claims one", async () => {
    const worker = bootServiceWorker("ok")

    const options = await shownOptions(worker, {
      v: 1,
      kind: "inbox",
      projectTitle: "Zalo",
      chatId: "chat-1",
      chatTitle: "An",
      chatUrl: "/inbox/t1",
      threadId: "t1",
      actions: [{ action: "send", title: "Send" }],
      ts: 1,
    })

    expect(options).not.toHaveProperty("actions")
    expect(options).not.toHaveProperty("data.approve")
  })

  test("a push without a preview keeps the generic wording", async () => {
    const worker = bootServiceWorker("ok")

    const options = await shownOptions(worker, { v: 1, kind: "inbox", projectTitle: "Zalo", chatId: "c", chatTitle: "An", chatUrl: "/inbox/t1", threadId: "t1", ts: 1 })

    expect(options).toMatchObject({ body: "An — Zalo" })
  })

  test("a chatUrl that leaves the app opens the home page instead", async () => {
    const worker = bootServiceWorker("ok")

    await worker.click({ chatUrl: "//evil.example/steal" }, "")

    expect(worker.opened).toEqual(["/"])
  })
})

describe("the Send action", () => {
  const DATA: JsonValue = { chatUrl: "/inbox/t1", approve: { threadId: "t1", proposalId: "p1" } }

  test("posts the ids to the approve route with the session cookie and confirms instead of opening the app", async () => {
    const worker = bootServiceWorker("ok")

    await worker.click(DATA, "send")

    expect(worker.fetches).toEqual([{
      url: HTTP_ROUTES.inboxProposalApprove.path,
      init: {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: "t1", proposalId: "p1" }),
      },
    }])
    expect(worker.shown.map((entry) => entry.options)).toEqual([expect.objectContaining({ body: "Sent" })])
    expect(worker.opened).toEqual([])
  })

  test("opens the thread once, without retrying, when the proposal is no longer open", async () => {
    const worker = bootServiceWorker("conflict")

    await worker.click(DATA, "send")

    expect(worker.fetches).toHaveLength(1)
    expect(worker.opened).toEqual(["/inbox/t1"])
    expect(worker.shown).toEqual([])
  })

  test("opens the thread once, without retrying, when the network fails", async () => {
    const worker = bootServiceWorker("offline")

    await worker.click(DATA, "send")

    expect(worker.fetches).toHaveLength(1)
    expect(worker.opened).toEqual(["/inbox/t1"])
  })

  test("tapping the notification body never sends, it opens the thread", async () => {
    const worker = bootServiceWorker("ok")

    await worker.click(DATA, "")

    expect(worker.fetches).toEqual([])
    expect(worker.opened).toEqual(["/inbox/t1"])
  })

  test("a Send action on a notification that carries no ids opens the thread instead of posting", async () => {
    const worker = bootServiceWorker("ok")

    await worker.click({ chatUrl: "/inbox/t1" }, "send")

    expect(worker.fetches).toEqual([])
    expect(worker.opened).toEqual(["/inbox/t1"])
  })
})
