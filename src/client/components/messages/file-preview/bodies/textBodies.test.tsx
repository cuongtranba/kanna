import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, beforeEach } from "bun:test"
import { renderThemed } from "../../../../lib/testing/renderThemed"
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
})

describe("TextBody/JsonBody/MarkdownBody static markup", () => {
  test("TextBody includes a <pre> shell so SSR snapshot is stable", () => {
    const html = renderThemed(<TextBody source={makeSrc("text/plain", "a.txt")} />, true)
    expect(html).toContain("<pre")
  })
  test("JsonBody includes a <pre> shell", () => {
    const html = renderThemed(<JsonBody source={makeSrc("application/json", "a.json")} />, true)
    expect(html).toContain("<pre")
  })
  test("MarkdownBody uses prose wrapper", () => {
    const html = renderThemed(<MarkdownBody source={makeSrc("text/markdown", "a.md")} />, true)
    expect(html).toContain("prose")
  })

  test("MarkdownBody renders mermaid fences as diagrams, not plain code", () => {
    const src = makeSrc("text/markdown", "plan.md")
    __seedTextBodyCacheForTests(src, {
      status: "ready",
      content: "# Plan\n\n```mermaid\nflowchart TB\n  A --> B\n```\n",
      truncated: false,
    })
    const html = renderThemed(<MarkdownBody source={src} />, true)
    expect(html).toContain("group/mermaid")
  })

  test("MarkdownBody renders GFM tables as html tables", () => {
    const src = makeSrc("text/markdown", "table.md")
    __seedTextBodyCacheForTests(src, {
      status: "ready",
      content: "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      truncated: false,
    })
    const html = renderThemed(<MarkdownBody source={src} />, true)
    expect(html).toContain("<table")
  })
})
