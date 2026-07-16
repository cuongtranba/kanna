import { describe, expect, test } from "bun:test"
import { downloadFile, shareViaWebShare } from "./actions"
import type { PreviewSource } from "./types"
import { makeFakeDomPort, makeFakeClipboardPort } from "../../../adapters/testing/makeFakePorts"

const SAMPLE: PreviewSource = {
  id: "x",
  contentUrl: "/u",
  displayName: "doc.txt",
  fileName: "doc.txt",
  mimeType: "text/plain",
  size: 10,
  origin: "user_attachment",
}

describe("shareViaWebShare", () => {
  test("calls navigator.share when available", async () => {
    const dom = makeFakeDomPort({ webShareSupported: true })
    const clipboard = makeFakeClipboardPort()
    const outcome = await shareViaWebShare(SAMPLE, { dom, clipboard })
    expect(outcome).toBe("shared")
    expect(dom.webShareCalls.length).toBe(1)
  })

  test("falls back to clipboard when share is missing", async () => {
    const dom = makeFakeDomPort({ webShareSupported: false })
    const clipboard = makeFakeClipboardPort()
    const outcome = await shareViaWebShare(SAMPLE, { dom, clipboard })
    expect(outcome).toBe("copied")
    expect(clipboard.writeCalls).toBe(1)
  })

  test("returns 'failed' when neither path works", async () => {
    const dom = makeFakeDomPort({ webShareSupported: false })
    const clipboard = makeFakeClipboardPort()
    clipboard.writeText = () => Promise.reject(new Error("no clipboard"))
    const outcome = await shareViaWebShare(SAMPLE, { dom, clipboard })
    expect(outcome).toBe("failed")
  })

  test("AbortError on share resolves silently as 'shared' (user dismissal is success)", async () => {
    const dom = makeFakeDomPort({ webShareSupported: true })
    dom.webShareError = new DOMException("user cancelled", "AbortError")
    const clipboard = makeFakeClipboardPort()
    const outcome = await shareViaWebShare(SAMPLE, { dom, clipboard })
    expect(outcome).toBe("shared")
  })
})

describe("downloadFile", () => {
  test("triggers download via DomPort", () => {
    const dom = makeFakeDomPort()
    downloadFile(SAMPLE, { dom })
    expect(dom.downloadCalls).toEqual([{ url: SAMPLE.contentUrl, filename: SAMPLE.fileName }])
  })
})
