import "../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { downloadFile, shareViaWebShare } from "./actions"
import type { PreviewSource } from "./types"

const SAMPLE: PreviewSource = {
  id: "x",
  contentUrl: "/u",
  displayName: "doc.txt",
  fileName: "doc.txt",
  mimeType: "text/plain",
  size: 10,
  origin: "user_attachment",
}

// happy-dom exposes navigator.clipboard as a non-writable getter on the prototype.
// We must use Object.defineProperty to override it in tests.
function setClipboard(value: { writeText: (text: string) => Promise<void> } | null): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => value })
}

describe("shareViaWebShare", () => {
  beforeEach(() => {
    delete (navigator as unknown as { share?: unknown }).share
    setClipboard(null)
  })
  afterEach(() => {
    delete (navigator as unknown as { share?: unknown }).share
    setClipboard(null)
  })

  test("calls navigator.share when available", async () => {
    const share = mock(async () => undefined)
    ;(navigator as unknown as { share: typeof share }).share = share
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("shared")
    expect(share).toHaveBeenCalledTimes(1)
  })

  test("falls back to clipboard when share is missing", async () => {
    const writeText = mock(async () => undefined)
    setClipboard({ writeText })
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("copied")
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  test("returns 'failed' when neither path works", async () => {
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("failed")
  })

  test("AbortError on share resolves silently as 'shared' (user dismissal is success)", async () => {
    const share = mock(async () => {
      throw new DOMException("user cancelled", "AbortError")
    })
    ;(navigator as unknown as { share: typeof share }).share = share
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("shared")
  })
})

describe("downloadFile", () => {
  test("creates anchor with download attribute, clicks, removes", () => {
    const anchor = { click: mock(() => undefined), setAttribute: mock(() => undefined), remove: mock(() => undefined), href: "", download: "" }
    const createElement = mock(() => anchor as unknown as HTMLAnchorElement)
    const origCreate = document.createElement.bind(document)
    const origAppend = document.body.appendChild.bind(document.body)
    document.createElement = createElement as unknown as typeof document.createElement
    // happy-dom's appendChild rejects a plain object (not a real Node);
    // stub it so the anchor-in-DOM requirement is satisfied without a DOM error.
    document.body.appendChild = mock(() => anchor as unknown as Node) as unknown as typeof document.body.appendChild
    try {
      downloadFile(SAMPLE)
      expect(anchor.click).toHaveBeenCalledTimes(1)
      expect(anchor.remove).toHaveBeenCalledTimes(1)
    } finally {
      document.createElement = origCreate
      document.body.appendChild = origAppend
    }
  })
})
