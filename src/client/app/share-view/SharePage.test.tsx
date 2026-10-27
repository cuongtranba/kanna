import { beforeEach, describe, expect, test } from "bun:test"
import { createElement } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import "../../lib/testing/setupHappyDom"
import { SharePage } from "./SharePage"
import { makeFakeHttpPort } from "../../adapters/testing/makeFakePorts"
import { waitFor } from "../../lib/testing/waitFor"
import type { ShareApiResponse } from "../../api/share"
import type { HttpPort } from "../../ports/httpPort"
import { CHAT_SNAPSHOT_VERSION, type ChatSnapshot } from "../../../shared/session-share/types"

const snap: ChatSnapshot = {
  version: CHAT_SNAPSHOT_VERSION,
  chatMeta: { id: "c1", title: "Hello world", model: "claude", createdAt: 0 },
  entries: [{ kind: "user_prompt", _id: "m1", createdAt: 0, content: "ping" }],
  datasets: {},
  attachmentsManifest: [],
}

function shareHttp(status: number, body: ShareApiResponse) {
  const http = makeFakeHttpPort()
  http.routes.push({ method: "GET", url: "/api/share/", response: { ok: status < 400, status, body } })
  return http
}

async function settled(container: HTMLElement) {
  await act(async () => {
    await waitFor(() => container.querySelector("[data-state='loading']") === null, 2000, "share to load")
  })
}

async function mount(token: string, http: HttpPort): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    const root = createRoot(container)
    root.render(
      createElement(QueryClientProvider, { client: queryClient },
        createElement(MemoryRouter, { initialEntries: [`/share/${token}`] },
          createElement(Routes, null,
            createElement(Route, { path: "/share/:token", element: createElement(SharePage, { http }) }),
          ),
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

  test("fetches /api/share/:token and renders snapshot", async () => {
    const http = shareHttp(200, { ok: true, snapshot: snap })
    const { container, cleanup } = await mount("tok-1", http)
    try {
      await settled(container)
      expect(http.calls).toEqual([{ method: "GET", url: "/api/share/tok-1" }])
      expect(container.innerHTML).toContain("Hello world")
      expect(container.innerHTML).toContain("ping")
    } finally {
      cleanup()
    }
  })

  test("renders not_found error for 404", async () => {
    const { container, cleanup } = await mount("tok-2", shareHttp(404, { ok: false, error: { kind: "not_found" } }))
    try {
      await settled(container)
      expect(container.innerHTML).toContain("Share not found")
      expect(container.querySelector("[data-state='error']")).not.toBeNull()
    } finally {
      cleanup()
    }
  })

  test("renders revoked error for 410", async () => {
    const { container, cleanup } = await mount("tok-3", shareHttp(410, { ok: false, error: { kind: "revoked" } }))
    try {
      await settled(container)
      expect(container.innerHTML).toContain("Share revoked")
    } finally {
      cleanup()
    }
  })
})
