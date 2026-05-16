import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PdfBody } from "./PdfBody"
import type { PreviewSource } from "../types"

const SRC: PreviewSource = {
  id: "p", contentUrl: "/u/x.pdf", displayName: "x.pdf", fileName: "x.pdf",
  mimeType: "application/pdf", size: 1, origin: "user_attachment",
}

describe("PdfBody", () => {
  test("renders iframe with sandbox attribute on desktop class wrapper", () => {
    const html = renderToStaticMarkup(<PdfBody source={SRC} />)
    expect(html).toContain('src="/u/x.pdf"')
    expect(html).toContain('sandbox="allow-same-origin allow-scripts"')
    expect(html).toContain("Open PDF externally")
  })
})
