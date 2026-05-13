import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LocalFileLinkCard } from "./LocalFileLinkCard"

describe("LocalFileLinkCard", () => {
  test("renders an attachment card with the link text and fetching state", () => {
    const html = renderToStaticMarkup(
      <LocalFileLinkCard path="/Users/cuongtran/Kanna/vk/.kanna/outputs/chibi-cute.png" linkText="chibi-cute.png" />,
    )
    expect(html).toContain("chibi-cute.png")
    expect(html).toContain("Fetching")
    expect(html).toContain("data-testid=\"local-file-link\"")
  })

  test("middle-truncates long filenames while preserving extension", () => {
    const html = renderToStaticMarkup(
      <LocalFileLinkCard
        path="/Users/me/cute-chibi-portrait-final-revision-v2.png"
        linkText="cute-chibi-portrait-final-revision-v2.png"
      />,
    )
    expect(html).toContain(".png")
    expect(html).toContain("…")
  })

  test("falls back to basename when linkText is empty", () => {
    const html = renderToStaticMarkup(
      <LocalFileLinkCard path="/Users/me/.kanna/outputs/build.zip" />,
    )
    expect(html).toContain("build.zip")
  })

  test("does not render a raw <a href='/Users/...'> that bypasses /api/local-file", () => {
    const html = renderToStaticMarkup(
      <LocalFileLinkCard path="/Users/me/photo.png" linkText="photo.png" />,
    )
    expect(html).not.toContain('href="/Users/')
  })
})
