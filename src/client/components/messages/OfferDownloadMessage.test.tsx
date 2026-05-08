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
  test("renders link with download attr and metadata", () => {
    const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage()} />)
    expect(html).toContain('href="/api/projects/p1/files/dist/build.zip/content"')
    expect(html).toContain('download="build.zip"')
    expect(html).toContain("Latest build")
    expect(html).toContain("application/zip")
    expect(html).toContain("2 KB")
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
