import "../../lib/testing/setupHappyDom"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedOfferDownloadToolCall } from "../../../shared/types"
import { OfferDownloadMessage } from "./OfferDownloadMessage"
import { makeFakeHttpPort } from "../../adapters/testing/makeFakePorts"
import type { HttpPort } from "../../ports/httpPort"

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

  test("preview-able mime (text/markdown) opens FilePreviewSheet on click and exposes Download in footer", async () => {
    const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage({
      result: {
        contentUrl: "/api/projects/p1/files/notes.md/content",
        relativePath: "notes.md", fileName: "notes.md", displayName: "Notes",
        size: 200, mimeType: "text/markdown",
      },
    })} />)
    expect(html).toContain("Preview")
  })

  test("non-preview-able mime (application/zip) keeps download-only behaviour (regression)", () => {
    const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage()} />)
    expect(html).toContain('download="build.zip"')
  })
})

describe("OfferDownloadMessage HEAD probe", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    root = null
    container = null
  })

  function headReturning(status: number): HttpPort {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "HEAD", url: "/api/projects/", response: { ok: status < 400, status, body: null } })
    return http
  }

  function headFailing(): HttpPort {
    return {
      ...makeFakeHttpPort(),
      head: async () => {
        throw new TypeError("Failed to fetch")
      },
    }
  }

  async function mount(message: HydratedOfferDownloadToolCall, http: HttpPort): Promise<HTMLElement> {
    container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container!)
      root.render(<OfferDownloadMessage message={message} http={http} />)
    })
    return container
  }

  test("404 marks the file as no longer available", async () => {
    const el = await mount(buildMessage(), headReturning(404))
    expect(el.innerHTML).toContain("File no longer available")
  })

  test("401 keeps the card clickable (auth failure is not a missing file)", async () => {
    const el = await mount(buildMessage(), headReturning(401))
    expect(el.innerHTML).not.toContain("File no longer available")
    expect(el.innerHTML).toContain('href="/api/projects/p1/files/dist/build.zip/content"')
  })

  test("5xx keeps the card clickable (transient proxy error is not a missing file)", async () => {
    const el = await mount(buildMessage(), headReturning(502))
    expect(el.innerHTML).not.toContain("File no longer available")
  })

  test("network failure keeps the card clickable", async () => {
    const el = await mount(buildMessage(), headFailing())
    expect(el.innerHTML).not.toContain("File no longer available")
  })
})
