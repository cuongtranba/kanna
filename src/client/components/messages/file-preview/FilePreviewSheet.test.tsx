import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FilePreviewSheet, SheetBody, shouldCloseFromDragEnd } from "./FilePreviewSheet"
import { Dialog } from "../../ui/dialog"
import type { PreviewSource } from "./types"

const SRC: PreviewSource = {
  id: "s1", contentUrl: "/u/r.zip", displayName: "r.zip", fileName: "r.zip",
  mimeType: "application/zip", size: 10, origin: "offer_download",
}

/** Wraps SheetBody in a Dialog root so Radix DialogTitle resolves its context. */
function renderSheetBody(source: PreviewSource) {
  return renderToStaticMarkup(
    createElement(Dialog, { open: true }, createElement(SheetBody, { source, onClose: () => {} })),
  )
}

describe("SheetBody", () => {
  test("when origin=offer_download, Download button rendered", () => {
    const html = renderSheetBody(SRC)
    expect(html).toContain("Download")
    expect(html).toContain("Share")
  })

  test("when origin=user_attachment, Download button NOT rendered", () => {
    const html = renderSheetBody({ ...SRC, origin: "user_attachment" })
    expect(html).not.toContain(">Download<")
    expect(html).toContain("Share")
  })

  test("displayName rendered in DialogTitle for screen readers", () => {
    const html = renderSheetBody(SRC)
    expect(html).toContain("r.zip")
  })
})

describe("FilePreviewSheet smoke", () => {
  test("renders without throwing when closed", () => {
    expect(() =>
      renderToStaticMarkup(<FilePreviewSheet source={null} open={false} onOpenChange={() => {}} />),
    ).not.toThrow()
  })

  test("renders without throwing when open with source", () => {
    expect(() =>
      renderToStaticMarkup(<FilePreviewSheet source={SRC} open onOpenChange={() => {}} />),
    ).not.toThrow()
  })
})

describe("shouldCloseFromDragEnd", () => {
  // Pure-logic test: the gesture wiring (pointer handlers → this fn → onClose)
  // is trivial, while mounting SheetBody and dispatching DOM pointer events
  // under happy-dom in the shared bun process was order-dependently flaky in CI
  // (a neighbor's portal unmount could corrupt React's event delegation).
  const base = { startY: 100, lastY: 100, lastT: 0, now: 1000 }

  test("closes when dragged past the distance threshold", () => {
    expect(shouldCloseFromDragEnd({ ...base, endY: 100 + 121 })).toBe(true)
  })

  test("stays open just under the distance threshold with no flick", () => {
    expect(shouldCloseFromDragEnd({ startY: 100, lastY: 220, lastT: 1000, endY: 220, now: 1000 })).toBe(false)
  })

  test("closes on a fast downward flick even under the distance threshold", () => {
    // 30px in 10ms → velocity 3 > 0.5
    expect(shouldCloseFromDragEnd({ startY: 100, lastY: 100, lastT: 990, endY: 130, now: 1000 })).toBe(true)
  })
})
