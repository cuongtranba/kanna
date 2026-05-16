import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FilePreviewSheet, SheetBody } from "./FilePreviewSheet"
import { Dialog } from "../../ui/dialog"
import type { PreviewSource } from "./types"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { test as t, expect as e2 } from "bun:test"

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

t("pointerdown on drag handle then pointermove dy>120 + pointerup → onOpenChange(false)", async () => {
  const onOpenChange = (() => { let v = true; return { call: (next: boolean) => { v = next }, get: () => v } })()
  const container = document.createElement("div")
  // Clean up any stale portals from prior renders
  document.body.querySelectorAll('[aria-label="Drag down to close"]').forEach((el) => {
    el.closest('[role="dialog"]')?.parentElement?.remove()
  })
  document.body.appendChild(container)
  const root = createRoot(container)
  // Render SheetBody directly inside Dialog (no portal) so the handle lands in container
  await act(async () => {
    root.render(
      <Dialog open>
        <SheetBody source={SRC} onClose={() => onOpenChange.call(false)} />
      </Dialog>
    )
  })
  // Handle is inside container, not a portal — query there first, fall back to body
  const allHandles = [
    ...Array.from(container.querySelectorAll('[aria-label="Drag down to close"]')),
    ...Array.from(document.body.querySelectorAll('[aria-label="Drag down to close"]')),
  ]
  const handle = allHandles[allHandles.length - 1] as HTMLElement | undefined
  e2(handle).toBeDefined()
  if (!handle) return
  await act(async () => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 100, pointerId: 1, bubbles: true }))
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, pointerId: 1, bubbles: true }))
    handle.dispatchEvent(new PointerEvent("pointerup", { clientY: 300, pointerId: 1, bubbles: true }))
  })
  e2(onOpenChange.get()).toBe(false)
  await act(async () => { root.unmount() })
  container.remove()
})
