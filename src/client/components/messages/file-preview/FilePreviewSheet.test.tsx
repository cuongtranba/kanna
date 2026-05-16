import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FilePreviewSheet, SheetBody } from "./FilePreviewSheet"
import { Dialog } from "../../ui/dialog"
import type { PreviewSource } from "./types"

const SRC: PreviewSource = {
  id: "s1", contentUrl: "/u/r.zip", displayName: "r.zip", fileName: "r.zip",
  mimeType: "application/zip", size: 10, origin: "offer_download",
}

/** Wraps SheetBody in a Dialog root so Radix DialogTitle resolves its context. */
function renderSheetBody(source: PreviewSource) {
  return renderToStaticMarkup(
    createElement(Dialog, { open: true }, createElement(SheetBody, { source })),
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
