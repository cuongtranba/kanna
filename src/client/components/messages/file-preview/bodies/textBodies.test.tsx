import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

mock.module("../../../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark", theme: "dark", setTheme: () => {} }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { TextBody } from "./TextBody"
import { JsonBody } from "./JsonBody"
import { MarkdownBody } from "./MarkdownBody"
import { __clearTextBodyCacheForTests, __seedTextBodyCacheForTests } from "./textLoader"
import type { PreviewSource } from "../types"

const makeSrc = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: `/u/${  name}`, displayName: name, fileName: name,
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

  test("MarkdownBody renders mermaid fences as diagrams, not plain code", () => {
    const src = makeSrc("text/markdown", "plan.md")
    __seedTextBodyCacheForTests(src, {
      status: "ready",
      content: "# Plan\n\n```mermaid\nflowchart TB\n  A --> B\n```\n",
      truncated: false,
    })
    const html = renderToStaticMarkup(<MarkdownBody source={src} />)
    expect(html).toContain("group/mermaid")
  })

  test("MarkdownBody renders GFM tables as html tables", () => {
    const src = makeSrc("text/markdown", "table.md")
    __seedTextBodyCacheForTests(src, {
      status: "ready",
      content: "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      truncated: false,
    })
    const html = renderToStaticMarkup(<MarkdownBody source={src} />)
    expect(html).toContain("<table")
  })
})
