import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedOfferDownloadToolCall } from "../../../shared/types"
import { OfferDownloadMessage } from "./OfferDownloadMessage"

function buildMessage(overrides: Partial<HydratedOfferDownloadToolCall> = {}): HydratedOfferDownloadToolCall {
  return {
    id: "msg-1",
    timestamp: new Date(0).toISOString(),
    kind: "tool",
    toolKind: "offer_download",
    toolName: "mcp__kanna__offer_download",
    toolId: "tool-1",
    input: { path: "dist/build.zip", label: "Latest build" },
    rawResult: undefined,
    isError: false,
    result: {
      contentUrl: "/api/projects/p1/files/dist/build.zip/content",
      relativePath: "dist/build.zip",
      fileName: "build.zip",
      displayName: "Latest build",
      size: 2048,
      mimeType: "application/zip",
    },
    ...overrides,
  }
}

describe("OfferDownloadMessage", () => {
  test("renders link with download attr, friendly mime, tabular-nums size, and aria-label", () => {
    const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage()} />)
    expect(html).toContain('href="/api/projects/p1/files/dist/build.zip/content"')
    expect(html).toContain('download="build.zip"')
    expect(html).toContain("Latest build")
    expect(html).toContain("ZIP archive")
    expect(html).not.toContain("application/zip")
    expect(html).toContain("tabular-nums")
    expect(html).toContain("2 KB")
    expect(html).toContain('aria-label="Download, Latest build, ZIP archive, 2 KB"')
  })

  test("uses file-type icon, not generic Download glyph", () => {
    const pdfMessage = buildMessage({
      result: {
        contentUrl: "/api/projects/p1/files/report.pdf/content",
        relativePath: "report.pdf",
        fileName: "report.pdf",
        displayName: "Q4 report",
        size: 4096,
        mimeType: "application/pdf",
      },
    })
    const html = renderToStaticMarkup(<OfferDownloadMessage message={pdfMessage} />)
    expect(html).toContain("PDF")
    expect(html).toContain("Q4 report")
  })

  test("does not use translucent glassmorphism background", () => {
    const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage()} />)
    expect(html).not.toContain("bg-background/85")
    expect(html).not.toContain("backdrop-blur")
  })

  test("renders nothing when result is missing", () => {
    const message = buildMessage({ result: undefined })
    const html = renderToStaticMarkup(<OfferDownloadMessage message={message} />)
    expect(html).toBe("")
  })

  test("falls back to file name when displayName empty", () => {
    const message = buildMessage({
      result: {
        contentUrl: "/api/projects/p1/files/report.pdf/content",
        relativePath: "report.pdf",
        fileName: "report.pdf",
        displayName: "",
        size: 0,
      },
    })
    const html = renderToStaticMarkup(<OfferDownloadMessage message={message} />)
    expect(html).toContain("report.pdf")
  })
})
