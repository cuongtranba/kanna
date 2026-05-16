import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { InlinePreviewCard } from "./InlinePreviewCard"
import type { PreviewSource } from "./types"

const mk = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 1024, origin: "user_attachment",
})

describe("InlinePreviewCard", () => {
  test("image kind → renders <img loading=lazy>", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("image/png", "a.png")} onOpen={() => {}} variant="expanded" />)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('src="/u/a.png"')
  })
  test("pdf kind → renders meta chip with PDF + size", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("application/pdf", "r.pdf")} onOpen={() => {}} variant="compact" />)
    expect(html).toContain("PDF")
    expect(html).toContain("1 KB")
  })
  test("audio kind → renders audio icon + filename", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("audio/mpeg", "a.mp3")} onOpen={() => {}} variant="compact" />)
    expect(html).toContain("a.mp3")
  })
  test("button has aria-label including 'Preview'", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("text/plain", "a.txt")} onOpen={() => {}} variant="compact" />)
    expect(html).toMatch(/aria-label="Preview/)
  })
})
