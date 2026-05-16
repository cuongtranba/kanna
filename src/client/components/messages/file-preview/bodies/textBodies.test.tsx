import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TextBody } from "./TextBody"
import { JsonBody } from "./JsonBody"
import { MarkdownBody } from "./MarkdownBody"
import { __clearTextBodyCacheForTests } from "./textLoader"
import type { PreviewSource } from "../types"

const makeSrc = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 100, origin: "user_attachment",
})

beforeEach(() => {
  __clearTextBodyCacheForTests()
  ;(globalThis as { fetch?: unknown }).fetch = mock(async () => new Response("hello world"))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("TextBody/JsonBody/MarkdownBody static markup", () => {
  test("TextBody includes a <pre> shell so SSR snapshot is stable", () => {
    const html = renderToStaticMarkup(<TextBody source={makeSrc("text/plain", "a.txt")} />)
    expect(html).toContain("<pre")
  })
  test("JsonBody includes a <pre> shell", () => {
    const html = renderToStaticMarkup(<JsonBody source={makeSrc("application/json", "a.json")} />)
    expect(html).toContain("<pre")
  })
  test("MarkdownBody uses prose wrapper", () => {
    const html = renderToStaticMarkup(<MarkdownBody source={makeSrc("text/markdown", "a.md")} />)
    expect(html).toContain("prose")
  })
})
