import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createElement } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import "../../lib/testing/setupHappyDom"
import { SharePage } from "./SharePage"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot } from "../../../shared/session-share/types"

const snap: ChatSnapshot = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "Hello world", model: "claude", createdAt: 0 },
  messages: [{ kind: "user_prompt", id: "m1", createdAt: 0, text: "ping" }],
  attachmentsManifest: [],
}

const originalFetch = globalThis.fetch
let fetchCalls: string[] = []

function installFetch(handler: (url: string) => Promise<Response>) {
  fetchCalls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    let url: string
    if (typeof input === "string") {
      url = input
    } else if (input instanceof URL) {
      url = input.toString()
    } else {
      url = input.url
    }
    fetchCalls.push(url)
    return handler(url)
  }) as typeof fetch
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function mount(token: string): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    const root = createRoot(container)
    root.render(
      createElement(MemoryRouter, { initialEntries: [`/share/${token}`] },
        createElement(Routes, null,
          createElement(Route, { path: "/share/:token", element: createElement(SharePage) }),
        ),
      ),
    )
  })
  return { container, cleanup: () => { container.remove() } }
}

describe("SharePage", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("fetches /api/share/:token and renders snapshot", async () => {
    installFetch(async () => Response.json({ ok: true, snapshot: snap }))
    const { container, cleanup } = await mount("tok-1")
    try {
      await flush()
      expect(fetchCalls).toEqual(["/api/share/tok-1"])
      expect(container.innerHTML).toContain("Hello world")
      expect(container.innerHTML).toContain("ping")
    } finally {
      cleanup()
    }
  })

  test("renders not_found error for 404", async () => {
    installFetch(async () => Response.json({ ok: false, error: { kind: "not_found" } }, { status: 404 }))
    const { container, cleanup } = await mount("tok-2")
    try {
      await flush()
      expect(container.innerHTML).toContain("Share not found")
      expect(container.querySelector("[data-state='error']")).not.toBeNull()
    } finally {
      cleanup()
    }
  })

  test("renders revoked error for 410", async () => {
    installFetch(async () => Response.json({ ok: false, error: { kind: "revoked" } }, { status: 410 }))
    const { container, cleanup } = await mount("tok-3")
    try {
      await flush()
      expect(container.innerHTML).toContain("Share revoked")
    } finally {
      cleanup()
    }
  })
})
