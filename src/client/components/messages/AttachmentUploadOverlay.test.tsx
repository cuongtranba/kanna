import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AttachmentUploadOverlay } from "./AttachmentUploadOverlay"

describe("AttachmentUploadOverlay", () => {
  test("renders rounded percent for determinate progress", () => {
    const html = renderToStaticMarkup(<AttachmentUploadOverlay progress={0.5} />)
    expect(html).toContain("50%")
    expect(html).toContain('aria-valuenow="50"')
    expect(html).toContain('role="progressbar"')
  })

  test("clamps progress to 0..1 range", () => {
    const high = renderToStaticMarkup(<AttachmentUploadOverlay progress={2} />)
    expect(high).toContain("100%")
    const low = renderToStaticMarkup(<AttachmentUploadOverlay progress={-1} />)
    expect(low).toContain("0%")
  })

  test("uses indeterminate spinner when progress is null", () => {
    const html = renderToStaticMarkup(<AttachmentUploadOverlay progress={null} />)
    expect(html).not.toContain("%")
    expect(html).toContain('aria-label="Uploading"')
    expect(html).toContain("animate-spin")
  })

  test("renders cancel button when onCancel provided", () => {
    const html = renderToStaticMarkup(
      <AttachmentUploadOverlay progress={0.25} onCancel={() => undefined} cancelLabel="Cancel test upload" />
    )
    expect(html).toContain('aria-label="Cancel test upload"')
  })

  test("omits cancel button when no handler given", () => {
    const html = renderToStaticMarkup(<AttachmentUploadOverlay progress={0.5} />)
    expect(html).not.toContain('aria-label="Cancel upload"')
    expect(html).not.toContain('aria-label="Cancel test upload"')
  })
})
