import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, beforeEach, afterEach, vi } from "vite-plus/test"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeBody } from "./CodeBody"

beforeEach(() => {
  ;(globalThis as { fetch?: unknown }).fetch = vi.fn(async () => new Response("const x = 1"))
  vi.doMock("shiki", () => ({ codeToHtml: async () => "<pre class='shiki'>mocked</pre>" }))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("CodeBody", () => {
  test("server-render outputs a <pre> wrapper (fallback markup before Shiki resolves)", () => {
    const html = renderToStaticMarkup(<CodeBody source={{
      id: "c", contentUrl: "/u/x.ts", displayName: "x.ts", fileName: "x.ts",
      mimeType: "text/plain", size: 10, origin: "user_attachment",
    }} />)
    expect(html).toContain("<pre")
  })
})
